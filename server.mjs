import { createServer } from "node:http";
import net from "node:net";
import tls from "node:tls";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_NAME = "Quét Dữ Liệu Doanh Nghiệp XNK";
const APP_VERSION = "0.4.2";
const ROOT = dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROOT = process.pkg ? dirname(process.execPath) : ROOT;
const DEFAULT_DATA_ROOT = process.pkg && process.platform === "darwin"
  ? join(homedir(), "Library", "Application Support", "QuetDuLieuDoanhNghiepXNK")
  : RUNTIME_ROOT;
const DATA_DIR = join(process.env.LEAD_SCANNER_DATA_DIR || DEFAULT_DATA_ROOT, "data");
const STORE_PATH = join(DATA_DIR, "leads.json");
const AUTH_COOKIE_NAME = "xnk_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_ADMIN_ID = "u_admin";
const DEFAULT_ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "admin@xnk.local").trim().toLowerCase();
const DEFAULT_ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "admin123456");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8080);
const LOCAL_URL = `http://${HOST}:${PORT}`;
const REQUEST_TIMEOUT_MS = 30_000;
const EMAIL_PAGE_TIMEOUT_MS = 8_000;
const PAGE_SIZE = 20;
const MAX_RESULTS = 60;
const MAX_PAGE_BYTES = 900_000;
const EMAIL_SCAN_CONCURRENCY = 4;
const CONTACT_PAGE_LIMIT = 4;
const EMAIL_RE = /(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?![\w.-])/g;
const LINK_RE = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
const CONTACT_PATHS = [
  "/contact",
  "/contact-us",
  "/contacts",
  "/about",
  "/about-us",
  "/company",
  "/impressum",
  "/imprint"
];
const CONTACT_LINK_HINTS = ["contact", "about", "company", "impressum", "imprint"];
const SKIP_EMAIL_HOSTS = [
  "instagram.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "chowbus.com",
  "ubereats.com",
  "doordash.com",
  "grubhub.com"
];
const activeEmailJobs = new Set();

function firstExistingPath(paths) {
  return paths.find((candidate) => candidate && existsSync(candidate));
}

function desktopAppLauncher(url) {
  if (process.platform === "win32") {
    const browsers = [
      join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe"),
      join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
      join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
      join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.ProgramFiles || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      join(process.env["ProgramFiles(x86)"] || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
    ];
    const browser = firstExistingPath(browsers);
    if (browser) return { command: browser, args: [`--app=${url}`, "--new-window"] };
    return { command: "cmd", args: ["/c", "start", "", url] };
  }

  if (process.platform === "darwin") {
    const browsers = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      join(homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      join(homedir(), "Applications", "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"),
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      join(homedir(), "Applications", "Brave Browser.app", "Contents", "MacOS", "Brave Browser")
    ];
    const browser = firstExistingPath(browsers);
    if (browser) return { command: browser, args: [`--app=${url}`, "--new-window"] };
    return { command: "open", args: [url] };
  }

  return { command: "xdg-open", args: [url] };
}

function defaultUrlLauncher(url) {
  if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  if (process.platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

function launchExternal(launcher, onComplete) {
  try {
    const child = execFile(launcher.command, launcher.args, { windowsHide: true }, (error) => {
      if (onComplete) onComplete(error);
    });
    child.unref?.();
    return child;
  } catch (error) {
    if (onComplete) onComplete(error);
    return null;
  }
}

function openBrowser(url) {
  if (!process.pkg || process.env.OPEN_BROWSER === "0") return;
  const launcher = desktopAppLauncher(url);
  launchExternal(launcher, (error) => {
    if (error) launchExternal(defaultUrlLauncher(url));
  });
}

const INDEX_HTML = String.raw`
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Quét Dữ Liệu Doanh Nghiệp XNK</title>
  <style>
    :root {
      color-scheme: light;
      --primary: #0f766e;
      --primary-dark: #0b5f59;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --bg: #f8fafc;
      --card: #ffffff;
      --border: #e5e7eb;
      --text: #0f172a;
      --muted: #64748b;
      --soft: #f1f5f9;
      --soft-2: #eef6f5;
      --shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
      --shadow-sm: 0 10px 28px rgba(15, 23, 42, 0.06);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
    }
    a { color: inherit; text-decoration: none; }
    button, input, textarea, select { font: inherit; }
    button { cursor: pointer; }
    .app-shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 268px minmax(0, 1fr);
      grid-template-rows: 74px minmax(0, 1fr);
    }
    .topbar {
      grid-column: 1 / -1;
      height: 74px;
      background: rgba(255,255,255,.92);
      backdrop-filter: blur(18px);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 22px;
      padding: 0 26px;
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 290px;
    }
    .brand-mark {
      width: 42px;
      height: 42px;
      border-radius: 14px;
      background: linear-gradient(135deg, #0f766e, #10b981);
      color: #fff;
      display: grid;
      place-items: center;
      font-weight: 800;
      box-shadow: 0 16px 30px rgba(15, 118, 110, .25);
    }
    .brand-title { display: grid; gap: 1px; }
    .brand-title strong { font-size: 15px; letter-spacing: 0; }
    .brand-title span { color: var(--muted); font-size: 12px; }
    .global-search {
      flex: 1;
      max-width: 520px;
      position: relative;
    }
    .global-search svg {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      color: #94a3b8;
      width: 18px;
      height: 18px;
    }
    .global-search input {
      width: 100%;
      height: 44px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: #fff;
      color: var(--text);
      outline: none;
      padding: 0 16px 0 42px;
      transition: border .18s ease, box-shadow .18s ease;
    }
    .global-search input:focus {
      border-color: rgba(15,118,110,.55);
      box-shadow: 0 0 0 4px rgba(15,118,110,.10);
    }
    .top-metrics {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-left: auto;
    }
    .top-chip {
      min-width: 92px;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: #fff;
      display: grid;
      gap: 1px;
    }
    .top-chip span { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .top-chip strong { font-size: 15px; }
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 999px;
      background: #0f172a;
      color: #fff;
      display: grid;
      place-items: center;
      font-weight: 800;
      margin-left: 4px;
    }
    .sidebar {
      grid-row: 2;
      border-right: 1px solid var(--border);
      background: rgba(255,255,255,.78);
      padding: 22px 16px;
      position: sticky;
      top: 74px;
      height: calc(100vh - 74px);
      overflow: auto;
    }
    .nav-group { display: grid; gap: 6px; }
    .nav-item {
      width: 100%;
      border: 0;
      background: transparent;
      color: #334155;
      min-height: 42px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 12px;
      font-weight: 700;
      transition: background .18s ease, color .18s ease, transform .18s ease;
      text-align: left;
    }
    .nav-item svg { width: 18px; height: 18px; color: #64748b; }
    .nav-item:hover { background: #f1f5f9; transform: translateX(2px); }
    .nav-item.active {
      background: #e8f5f3;
      color: var(--primary-dark);
    }
    .nav-item.active svg { color: var(--primary); }
    .sidebar-footer {
      margin-top: 26px;
      padding: 16px;
      border-radius: 18px;
      background: #0f172a;
      color: #fff;
      display: grid;
      gap: 10px;
      box-shadow: var(--shadow-sm);
    }
    .sidebar-footer span { color: #cbd5e1; line-height: 1.45; font-size: 12px; }
    .main {
      min-width: 0;
      padding: 26px;
      display: grid;
      gap: 20px;
    }
    .page-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .page-title { display: grid; gap: 6px; }
    .page-title h1 {
      margin: 0;
      font-size: clamp(24px, 3vw, 34px);
      line-height: 1.08;
      font-weight: 750;
      letter-spacing: 0;
    }
    .page-title p { margin: 0; color: var(--muted); line-height: 1.5; }
    .page-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .button {
      border: 1px solid transparent;
      min-height: 42px;
      border-radius: 12px;
      padding: 0 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-weight: 800;
      color: #fff;
      background: var(--primary);
      transition: transform .18s ease, box-shadow .18s ease, background .18s ease, border .18s ease;
      white-space: nowrap;
    }
    .button svg { width: 17px; height: 17px; }
    .button:hover { background: var(--primary-dark); transform: translateY(-1px); box-shadow: 0 12px 22px rgba(15,118,110,.18); }
    .button.secondary {
      background: #fff;
      color: #0f172a;
      border-color: var(--border);
    }
    .button.secondary:hover { background: #f8fafc; box-shadow: var(--shadow-sm); }
    .button.ghost {
      background: transparent;
      color: #334155;
      border-color: transparent;
    }
    .button.ghost:hover { background: #f1f5f9; box-shadow: none; }
    .button.danger { background: #fff1f2; color: #be123c; border-color: #ffe4e6; }
    .button.danger:hover { background: #ffe4e6; box-shadow: none; }
    .button:disabled { opacity: .62; cursor: wait; transform: none; box-shadow: none; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }
    .kpi-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 22px;
      padding: 18px;
      display: flex;
      justify-content: space-between;
      gap: 14px;
      min-height: 116px;
      box-shadow: var(--shadow-sm);
      transition: transform .18s ease, box-shadow .18s ease;
    }
    .kpi-card:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
    .kpi-copy { display: grid; gap: 8px; }
    .kpi-copy span { color: var(--muted); font-weight: 800; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .kpi-copy strong { font-size: 30px; line-height: 1; }
    .kpi-copy small { color: var(--muted); font-weight: 650; }
    .kpi-icon {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: #ecfdf5;
      color: var(--success);
      display: grid;
      place-items: center;
      flex: 0 0 auto;
    }
    .kpi-icon svg { width: 21px; height: 21px; }
    .workspace-grid {
      display: grid;
      grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }
    .panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 24px;
      box-shadow: var(--shadow-sm);
      overflow: hidden;
    }
    .panel-head {
      padding: 18px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid #eef2f7;
    }
    .panel-head h2 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: 0; }
    .panel-head span { color: var(--muted); font-size: 12px; font-weight: 700; }
    .search-panel form {
      padding: 20px;
      display: grid;
      gap: 14px;
    }
    .field { display: grid; gap: 7px; }
    .field label, label.field {
      color: #334155;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .01em;
    }
    .field input, .field textarea, .field select {
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--border);
      border-radius: 13px;
      color: var(--text);
      background: #fff;
      outline: none;
      padding: 10px 12px;
      transition: border .18s ease, box-shadow .18s ease, background .18s ease;
    }
    .field textarea { min-height: 150px; resize: vertical; line-height: 1.55; }
    .field input:focus, .field textarea:focus, .field select:focus {
      border-color: rgba(15,118,110,.55);
      box-shadow: 0 0 0 4px rgba(15,118,110,.10);
    }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .check-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 2px 0;
    }
    .check-row label { display: flex; align-items: center; gap: 9px; color: #334155; font-weight: 750; font-size: 13px; }
    input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--primary); }
    .search-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding-top: 4px; }
    .status-line { color: var(--muted); min-height: 20px; line-height: 1.45; }
    .activity-log {
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 16px;
      color: #475569;
      font-size: 12px;
      line-height: 1.55;
      max-height: 170px;
      overflow: auto;
      padding: 12px;
      white-space: pre-wrap;
    }
    .results-panel { min-width: 0; }
    .filter-bar {
      position: sticky;
      top: 90px;
      z-index: 10;
      background: rgba(248,250,252,.92);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
      box-shadow: 0 12px 30px rgba(15, 23, 42, .05);
    }
    .tabs { display: flex; gap: 6px; overflow: auto; }
    .tab {
      border: 0;
      background: transparent;
      color: #475569;
      min-height: 36px;
      border-radius: 12px;
      padding: 0 12px;
      font-weight: 800;
      white-space: nowrap;
      transition: background .18s ease, color .18s ease;
    }
    .tab.active { background: #0f172a; color: #fff; }
    .bulk-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .select-hint { color: var(--muted); font-weight: 750; font-size: 12px; }
    .lead-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .lead-card {
      position: relative;
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 22px;
      padding: 18px;
      min-height: 260px;
      display: grid;
      gap: 14px;
      box-shadow: var(--shadow-sm);
      transition: transform .18s ease, border .18s ease, box-shadow .18s ease;
    }
    .lead-card:hover { transform: translateY(-2px); border-color: rgba(15,118,110,.28); box-shadow: var(--shadow); }
    .lead-top { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 12px; align-items: start; }
    .company-block { min-width: 0; display: grid; gap: 5px; }
    .company-name { font-weight: 850; font-size: 16px; line-height: 1.25; color: #0f172a; word-break: break-word; }
    .company-meta { color: var(--muted); font-size: 12px; line-height: 1.4; word-break: break-word; }
    .website-link { color: var(--primary-dark); font-weight: 750; word-break: break-all; }
    .score-badge, .status-pill, .tag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border-radius: 999px;
      font-weight: 850;
      white-space: nowrap;
    }
    .score-badge { padding: 7px 10px; font-size: 12px; }
    .score-hot { background: #dcfce7; color: #15803d; }
    .score-warm { background: #fef3c7; color: #b45309; }
    .score-cold { background: #f1f5f9; color: #475569; }
    .lead-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .fact {
      border: 1px solid #eef2f7;
      background: #f8fafc;
      border-radius: 15px;
      padding: 10px;
      min-width: 0;
      display: grid;
      gap: 4px;
    }
    .fact span { color: var(--muted); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .fact strong { font-size: 13px; line-height: 1.35; word-break: break-word; }
    .status-list { display: flex; flex-wrap: wrap; gap: 7px; }
    .status-pill {
      border: 1px solid transparent;
      min-height: 30px;
      padding: 0 10px;
      font-size: 12px;
      background: #f8fafc;
      color: #475569;
      transition: transform .18s ease, border .18s ease, background .18s ease;
    }
    .status-pill:hover { transform: translateY(-1px); border-color: #cbd5e1; }
    .status-pill.active { background: #e8f5f3; color: var(--primary-dark); border-color: rgba(15,118,110,.22); }
    .status-contacted.active { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
    .status-interested.active { background: #ecfdf5; color: #047857; border-color: #bbf7d0; }
    .status-follow_up.active { background: #fffbeb; color: #b45309; border-color: #fde68a; }
    .status-closed.active { background: #f1f5f9; color: #334155; border-color: #cbd5e1; }
    .status-lost.active { background: #fff1f2; color: #be123c; border-color: #fecdd3; }
    .tags { display: flex; flex-wrap: wrap; gap: 7px; }
    .tag { background: #f1f5f9; color: #475569; padding: 6px 9px; font-size: 11px; }
    .card-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; }
    .action-btn {
      border: 1px solid var(--border);
      background: #fff;
      color: #334155;
      border-radius: 11px;
      min-height: 34px;
      padding: 0 10px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 800;
      font-size: 12px;
      transition: background .18s ease, transform .18s ease, border .18s ease;
    }
    .action-btn:hover { background: #f8fafc; transform: translateY(-1px); border-color: #cbd5e1; }
    .action-btn svg { width: 15px; height: 15px; }
    .empty-state {
      min-height: 360px;
      border: 1px dashed #cbd5e1;
      border-radius: 24px;
      display: grid;
      place-items: center;
      text-align: center;
      padding: 34px;
      color: var(--muted);
      background: #fff;
    }
    .empty-state strong { color: var(--text); font-size: 18px; display: block; margin-bottom: 8px; }
    .skeleton-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px; }
    .skeleton-card { height: 250px; border-radius: 22px; background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%); background-size: 400% 100%; animation: shimmer 1.3s ease infinite; }
    @keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
    .drawer-backdrop, .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15,23,42,.34);
      backdrop-filter: blur(6px);
      z-index: 60;
      opacity: 0;
      pointer-events: none;
      transition: opacity .2s ease;
    }
    .drawer-backdrop.open, .modal-backdrop.open { opacity: 1; pointer-events: auto; }
    .drawer {
      position: fixed;
      top: 0;
      right: 0;
      z-index: 70;
      width: min(520px, 100vw);
      height: 100vh;
      background: #fff;
      border-left: 1px solid var(--border);
      box-shadow: -24px 0 60px rgba(15,23,42,.16);
      transform: translateX(105%);
      transition: transform .24s ease;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }
    .drawer.open { transform: translateX(0); }
    .drawer-head {
      padding: 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }
    .drawer-title { display: grid; gap: 4px; min-width: 0; }
    .drawer-title h3 { margin: 0; font-size: 18px; line-height: 1.25; }
    .drawer-title span { color: var(--muted); font-size: 13px; word-break: break-word; }
    .icon-button {
      border: 1px solid var(--border);
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: #fff;
      color: #334155;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
    }
    .icon-button svg { width: 18px; height: 18px; }
    .drawer-body { overflow: auto; padding: 20px; display: grid; gap: 16px; }
    .detail-section {
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 16px;
      display: grid;
      gap: 12px;
      background: #fff;
    }
    .detail-section h4 { margin: 0; font-size: 13px; text-transform: uppercase; color: #475569; letter-spacing: .04em; }
    .detail-list { display: grid; gap: 10px; }
    .detail-row { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 10px; line-height: 1.45; }
    .detail-row span { color: var(--muted); font-weight: 750; }
    .detail-row strong { word-break: break-word; }
    .timeline { display: grid; gap: 12px; }
    .timeline-item { display: grid; grid-template-columns: 22px minmax(0,1fr); gap: 10px; align-items: start; }
    .dot { width: 10px; height: 10px; border-radius: 999px; background: var(--primary); margin: 5px auto 0; box-shadow: 0 0 0 5px #e8f5f3; }
    .timeline-item strong { display: block; font-size: 13px; }
    .timeline-item span { color: var(--muted); font-size: 12px; }
    .modal {
      position: fixed;
      left: 50%;
      top: 50%;
      z-index: 80;
      width: min(720px, calc(100vw - 28px));
      max-height: calc(100vh - 36px);
      overflow: auto;
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 26px;
      box-shadow: var(--shadow);
      transform: translate(-50%, -46%) scale(.98);
      opacity: 0;
      pointer-events: none;
      transition: opacity .2s ease, transform .2s ease;
    }
    .modal.open { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%) scale(1); }
    .modal-head { padding: 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .modal-head h3 { margin: 0; font-size: 18px; }
    .modal-head p { margin: 4px 0 0; color: var(--muted); line-height: 1.45; }
    .modal-body { padding: 20px; display: grid; gap: 14px; }
    .toast-stack { position: fixed; right: 18px; bottom: 18px; z-index: 100; display: grid; gap: 10px; }
    .toast {
      min-width: min(360px, calc(100vw - 36px));
      border: 1px solid var(--border);
      border-left: 4px solid var(--primary);
      background: #fff;
      border-radius: 16px;
      padding: 13px 14px;
      box-shadow: var(--shadow);
      color: #334155;
      animation: toastIn .22s ease both;
    }
    .toast strong { display: block; color: var(--text); margin-bottom: 2px; }
    .toast.error { border-left-color: var(--danger); }
    .toast.success { border-left-color: var(--success); }
    @keyframes toastIn { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .mobile-menu { display: none; }
    @media (max-width: 1180px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .workspace-grid { grid-template-columns: 1fr; }
      .lead-grid, .skeleton-grid { grid-template-columns: 1fr; }
      .search-panel { order: 1; }
      .results-panel { order: 2; }
    }
    @media (max-width: 880px) {
      .app-shell { grid-template-columns: 1fr; grid-template-rows: auto auto minmax(0, 1fr); }
      .topbar { position: static; height: auto; padding: 16px; flex-wrap: wrap; }
      .brand { min-width: 0; flex: 1; }
      .global-search { order: 3; max-width: none; flex: 0 0 100%; }
      .top-metrics { display: none; }
      .sidebar { grid-row: 2; position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--border); padding: 10px 14px; overflow: auto; }
      .nav-group { display: flex; overflow: auto; }
      .nav-item { flex: 0 0 auto; width: auto; }
      .sidebar-footer { display: none; }
      .main { padding: 18px 14px 28px; }
      .page-head { display: grid; }
      .page-actions { justify-content: start; }
      .filter-bar { position: static; align-items: flex-start; flex-direction: column; }
      .bulk-actions { justify-content: start; }
    }
    @media (max-width: 620px) {
      .kpi-grid { grid-template-columns: 1fr; }
      .field-row { grid-template-columns: 1fr; }
      .search-actions { grid-template-columns: 1fr; }
      .lead-facts { grid-template-columns: 1fr; }
      .drawer { width: 100vw; }
      .detail-row { grid-template-columns: 1fr; gap: 3px; }
      .brand-title strong { font-size: 13px; }
      .brand-mark { width: 38px; height: 38px; }
    }

    .mini-trend{color:var(--success)!important;font-weight:850!important}.theme-toggle{border-radius:999px}.advanced-filters{border:1px solid var(--border);border-radius:16px;background:#f8fafc;padding:4px 12px 12px}.advanced-filters summary{min-height:42px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;color:#334155;font-weight:900}.advanced-filters summary small{color:var(--muted);font-weight:750}.advanced-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding-top:8px}.primary-search{padding-top:0}.view-toggle{display:inline-flex;align-items:center;gap:4px;padding:4px;border:1px solid var(--border);border-radius:999px;background:#fff;box-shadow:0 8px 22px rgba(15,23,42,.05)}.view-toggle button{border:0;min-height:30px;padding:0 12px;border-radius:999px;background:transparent;color:var(--muted);font-size:12px;font-weight:850;transition:background .18s ease,color .18s ease,transform .18s ease}.view-toggle button.active{background:#0f172a;color:#fff}.view-toggle button:hover{transform:translateY(-1px)}
    .lead-card{border-radius:18px;padding:14px;min-height:156px;gap:11px;animation:cardIn .2s ease both}.lead-card.dragging{opacity:.55;transform:scale(.99)}.lead-card.pipeline-card{min-height:136px;padding:12px;border-radius:16px}@keyframes cardIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.lead-top{grid-template-columns:24px 44px minmax(0,1fr) auto;gap:10px}.lead-checkbox{margin-top:13px}.company-avatar{width:44px;height:44px;border-radius:13px;border:1px solid rgba(15,118,110,.14);background:linear-gradient(135deg,#ecfdf5,#dbeafe);color:#0f766e;display:grid;place-items:center;overflow:hidden;font-weight:900;font-size:13px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.62)}.company-avatar img{width:100%;height:100%;object-fit:cover;background:#fff}.company-name{font-size:15px;font-weight:900}.lead-info-row{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;color:#334155;font-size:12px}.info-item{display:inline-flex;align-items:center;gap:6px;min-width:0;line-height:1.35;color:inherit}.info-item svg{width:14px;height:14px;color:var(--primary);flex:0 0 auto}.info-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.info-item.muted{color:var(--muted)}
    .score-badge{display:inline-grid;gap:2px;min-width:94px;justify-items:center;border-radius:16px;padding:8px 10px;color:#fff;font-weight:900;text-align:center;box-shadow:0 14px 26px rgba(15,23,42,.13);white-space:nowrap}.score-badge b{font-size:11px;line-height:1;letter-spacing:.03em}.score-badge small{font-size:11px;opacity:.9}.score-hot{background:linear-gradient(135deg,#10b981,#059669 46%,#047857);color:#fff}.score-warm{background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff}.score-cold{background:linear-gradient(135deg,#64748b,#334155);color:#fff}.status-list{display:flex;gap:6px;overflow:auto;padding-bottom:1px;scrollbar-width:thin}.status-pill{min-height:28px;padding:0 9px;font-size:11px}.lead-card-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}.tags{flex-wrap:nowrap;overflow:hidden;min-width:0}.tag{max-width:140px;overflow:hidden;text-overflow:ellipsis}.card-actions{flex-wrap:nowrap;gap:7px;margin-left:auto}.action-btn{border-radius:10px;min-height:32px;padding:0 9px;font-weight:850}.action-btn svg{width:14px;height:14px}
    .kanban-board{display:grid;grid-template-columns:repeat(6,minmax(260px,1fr));gap:12px;overflow-x:auto;padding-bottom:8px}.kanban-column{min-height:560px;border:1px solid var(--border);border-radius:18px;background:rgba(255,255,255,.72);padding:10px;display:grid;grid-template-rows:auto minmax(0,1fr);gap:10px;transition:border .18s ease,background .18s ease,box-shadow .18s ease}.kanban-column.drag-over{border-color:rgba(16,185,129,.55);background:#ecfdf5;box-shadow:0 0 0 4px rgba(16,185,129,.10)}.kanban-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 4px 0}.kanban-head strong{font-size:13px}.kanban-count{min-width:26px;height:24px;border-radius:999px;background:#f1f5f9;color:#475569;display:grid;place-items:center;font-size:12px;font-weight:900}.kanban-items{display:grid;align-content:start;gap:10px}
    .detail-profile{display:grid;grid-template-columns:54px minmax(0,1fr);gap:12px;align-items:center}.detail-profile .company-avatar{width:54px;height:54px;border-radius:16px}.detail-profile strong{display:block;font-size:16px;margin-bottom:3px;word-break:break-word}.timeline-item{position:relative}.timeline-item:not(:last-child)::after{content:"";position:absolute;left:10px;top:25px;bottom:-11px;width:1px;background:var(--border)}.timeline-time{color:var(--muted);font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.04em}.email-history{display:grid;gap:10px}.email-entry{border:1px solid var(--border);border-radius:14px;padding:12px;display:grid;gap:5px;background:#f8fafc}.email-entry strong{font-size:13px}.email-entry span{color:var(--muted);font-size:12px}
    body.theme-dark{color-scheme:dark;--bg:#0F172A;--card:#1E293B;--border:#334155;--text:#F8FAFC;--muted:#CBD5E1;--soft:#0f172a;--soft-2:#12312e;--shadow:0 22px 60px rgba(0,0,0,.32);--shadow-sm:0 12px 34px rgba(0,0,0,.22);background:var(--bg)}body.theme-dark .topbar,body.theme-dark .sidebar{background:rgba(15,23,42,.9)}body.theme-dark .panel,body.theme-dark .lead-card,body.theme-dark .drawer,body.theme-dark .modal,body.theme-dark .top-chip,body.theme-dark .view-toggle,body.theme-dark .icon-button,body.theme-dark .action-btn,body.theme-dark .empty-state,body.theme-dark .toast{background:var(--card);border-color:var(--border);color:var(--text)}body.theme-dark .field input,body.theme-dark .field textarea,body.theme-dark .field select,body.theme-dark .global-search input,body.theme-dark .activity-log,body.theme-dark .advanced-filters,body.theme-dark .email-entry,body.theme-dark .kanban-column{background:#0f172a;border-color:var(--border);color:var(--text)}body.theme-dark .company-name,body.theme-dark .drawer-title h3,body.theme-dark .panel-head h2,body.theme-dark .empty-state strong,body.theme-dark .toast strong{color:var(--text)}body.theme-dark .field label,body.theme-dark label.field,body.theme-dark .check-row label,body.theme-dark .advanced-filters summary,body.theme-dark .action-btn{color:#e2e8f0}body.theme-dark .tab.active,body.theme-dark .view-toggle button.active{background:#10B981;color:#052e2b}body.theme-dark .status-pill,body.theme-dark .tag,body.theme-dark .kanban-count{background:#162033;color:#dbeafe}body.theme-dark .status-pill.active{background:rgba(16,185,129,.18);color:#6ee7b7;border-color:rgba(16,185,129,.34)}body.theme-dark .website-link{color:#5eead4}body.theme-dark .company-avatar{background:linear-gradient(135deg,#064e3b,#1e3a8a);color:#d1fae5;border-color:#334155}
    @media (max-width:1180px){.lead-info-row{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (max-width:620px){.lead-top{grid-template-columns:24px 44px minmax(0,1fr)}.lead-top .score-badge{grid-column:2/-1;justify-self:start}.lead-info-row,.advanced-grid{grid-template-columns:1fr}.lead-card-footer{align-items:flex-start;flex-direction:column}.card-actions{margin-left:0;flex-wrap:wrap}.view-toggle{width:100%;justify-content:center}}

    .mini-icon{width:14px;display:inline-grid;place-items:center;color:var(--primary);font-weight:900;flex:0 0 auto}
    .language-toggle{border:1px solid var(--border);height:38px;border-radius:999px;background:#fff;color:#334155;display:inline-flex;align-items:center;gap:4px;padding:3px;font-weight:850;box-shadow:0 8px 22px rgba(15,23,42,.05)}
    .language-toggle span{min-width:32px;height:30px;border-radius:999px;display:grid;place-items:center;font-size:12px;line-height:1;transition:background .18s ease,color .18s ease}
    .language-toggle span.active{background:var(--primary);color:#fff}
    body.theme-dark .language-toggle{background:var(--card);border-color:var(--border);color:var(--text)}
    body.theme-dark .language-toggle span.active{background:#10B981;color:#052e2b}

    .auth-screen{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:24px;background:#f8fafc;color:var(--text)}
    .auth-screen[hidden]{display:none!important}
    .auth-card{width:min(440px,100%);background:#fff;border:1px solid var(--border);border-radius:20px;box-shadow:0 24px 70px rgba(15,23,42,.18);padding:28px;display:grid;gap:18px}
    .auth-brand{display:flex;align-items:center;gap:12px}.auth-brand strong{display:block;font-size:18px}.auth-brand span{display:block;color:var(--muted);font-weight:700;font-size:13px;margin-top:3px}
    .auth-card form{display:grid;gap:14px}.auth-error{min-height:18px;color:#be123c;font-size:13px;font-weight:800}.auth-meta{color:var(--muted);font-size:12px;line-height:1.5}
    body.auth-locked .app-shell,body.auth-locked .drawer,body.auth-locked .modal,body.auth-locked .drawer-backdrop,body.auth-locked .modal-backdrop{display:none!important}
    body.admin-force .workspace-page{display:none!important}body.admin-force #adminConsole{display:grid!important}
    .admin-only[hidden]{display:none!important}.user-menu{min-height:38px;padding:0 12px;white-space:nowrap}.avatar{font-size:13px;text-transform:uppercase}
    .user-list{display:grid;gap:10px}.user-item{border:1px solid var(--border);border-radius:14px;padding:12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;background:#f8fafc}.user-item strong{display:block}.user-item span{color:var(--muted);font-size:12px;font-weight:750}.user-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.role-pill{display:inline-flex;align-items:center;height:24px;border-radius:999px;padding:0 8px;background:#ecfdf5;color:#047857;font-size:11px;font-weight:900}.modal .user-create-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.modal .user-create-grid .full{grid-column:1/-1}
    .workspace-page[hidden],.admin-console[hidden]{display:none!important}.admin-console{display:grid;gap:16px}.admin-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.admin-head h2{margin:0;font-size:24px}.admin-head p{margin:6px 0 0;color:var(--muted);font-weight:700}.admin-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.admin-kpi{border:1px solid var(--border);border-radius:18px;background:#fff;padding:16px;box-shadow:var(--shadow-sm);display:grid;gap:6px}.admin-kpi span{color:var(--muted);font-size:12px;font-weight:850;text-transform:uppercase}.admin-kpi strong{font-size:28px;color:var(--text)}.admin-layout{display:grid;grid-template-columns:minmax(280px,360px) minmax(0,1fr);gap:16px}.admin-create-form{padding:18px;display:grid;gap:12px}.admin-table-wrap{overflow:auto;border-top:1px solid var(--border)}.admin-table{width:100%;border-collapse:collapse;min-width:900px}.admin-table th,.admin-table td{padding:12px 14px;border-bottom:1px solid var(--border);text-align:left;font-size:13px;vertical-align:middle}.admin-table th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em;background:#f8fafc}.admin-table strong{display:block}.admin-table small{display:block;color:var(--muted);margin-top:3px}.admin-table input,.admin-table select{min-height:34px;border:1px solid var(--border);border-radius:10px;padding:0 9px;background:#fff;color:var(--text);font-weight:750}.admin-row-actions{display:flex;gap:7px;flex-wrap:wrap}.status-dot{display:inline-flex;align-items:center;gap:6px;font-weight:900}.status-dot::before{content:"";width:8px;height:8px;border-radius:999px;background:#10b981}.status-dot.locked::before{background:#e11d48}
    body.theme-dark .auth-screen{background:#0f172a}body.theme-dark .auth-card,body.theme-dark .user-item,body.theme-dark .admin-kpi{background:var(--card);border-color:var(--border);color:var(--text)}body.theme-dark .admin-table th{background:#0f172a}body.theme-dark .admin-table input,body.theme-dark .admin-table select{background:#0f172a;border-color:var(--border);color:var(--text)}
    @media (max-width:1180px){.admin-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.admin-layout{grid-template-columns:1fr}}@media (max-width:620px){.modal .user-create-grid{grid-template-columns:1fr}.user-item{grid-template-columns:1fr}.user-actions{justify-content:flex-start}.user-menu{display:none}.admin-head{display:grid}.admin-kpis{grid-template-columns:1fr}.admin-create-form{padding:14px}}

  </style>
</head>
<body class="auth-locked">

  <section class="auth-screen" id="authScreen" hidden>
    <div class="auth-card">
      <div class="auth-brand"><div class="brand-mark">XNK</div><div><strong>Quét Dữ Liệu Doanh Nghiệp XNK</strong><span>Đăng nhập workspace</span></div></div>
      <form id="loginForm">
        <div class="field"><label for="loginEmail">Email</label><input id="loginEmail" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="loginPassword">Mật khẩu</label><input id="loginPassword" name="password" type="password" autocomplete="current-password" required></div>
        <button class="button" id="loginButton" type="submit">Đăng nhập</button>
        <div class="auth-error" id="loginError"></div>
      </form>
      <div class="auth-meta">Admin có thể tạo tài khoản cho người khác trong mục Users.</div>
    </div>
  </section>

  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">XNK</div>
        <div class="brand-title">
          <strong>Quét Dữ Liệu Doanh Nghiệp XNK</strong>
          <span>Thân tặng chị Rose Hong</span>
        </div>
      </div>
      <div class="global-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
    <input id="globalLeadSearch" placeholder="Tìm công ty, email, website, địa chỉ">
      </div>
      <div class="top-metrics">
        <div class="top-chip"><span>Leads</span><strong id="topLeadCount">0</strong></div>
        <div class="top-chip"><span>Email</span><strong id="topEmailSent">0</strong></div>
        <div class="top-chip"><span>Interested</span><strong id="topInterested">0</strong></div>
        <button class="language-toggle" id="languageToggle" type="button" aria-label="Switch language"><span data-lang-option="vi">VI</span><span data-lang-option="en">EN</span></button>
        <button class="icon-button admin-only" id="openUsersButton" type="button" aria-label="Manage users" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></button>
        <button class="icon-button theme-toggle" id="themeToggle" type="button" aria-label="Toggle dark mode" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 7.5A9 9 0 1 1 12 3Z"></path></svg></button>
        <button class="button secondary user-menu" id="logoutButton" type="button">Đăng xuất</button>
        <div class="avatar" id="currentUserAvatar">RH</div>
      </div>
    </header>

    <aside class="sidebar">
      <nav class="nav-group">
        <button class="nav-item active" type="button" data-nav="dashboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect></svg>Dashboard</button>
        <button class="nav-item" type="button" data-nav="finder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>Lead Finder</button>
        <button class="nav-item" type="button" data-nav="pipeline"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M7 12h10"></path><path d="M10 18h4"></path></svg>Lead Pipeline</button>
        <button class="nav-item" type="button" id="openComposerNav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>Email Campaigns</button>
        <button class="nav-item" type="button" id="templateNav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h6"></path></svg>Templates</button>
        <a class="nav-item" href="/export.xls"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path></svg>Exports</a>
        <button class="nav-item" type="button" id="openSettingsNav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"></path><circle cx="12" cy="12" r="3"></circle></svg>Settings</button>
        <button class="nav-item admin-only" type="button" data-nav="admin" id="adminConsoleNav" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18"></path><path d="M3 8h18"></path><path d="M3 16h18"></path><path d="M8 3v18"></path><path d="M16 3v18"></path></svg>Admin Console</button>
      </nav>
      <div class="sidebar-footer">
        <strong>Premium CRM Workspace</strong>
        <span>Quản lý lead, email outreach và ghi chú trong một dashboard gọn gàng.</span>
      </div>
    </aside>

    <main class="main">
      <div class="page-head workspace-page" id="workspaceHead">
        <div class="page-title">
          <h1>Lead Generation & Email Outreach</h1>
          <p>Quét doanh nghiệp, phân loại cơ hội và gửi email tiếp cận trong cùng một không gian CRM.</p>
        </div>
        <div class="page-actions">
          <button class="button secondary" id="openSettingsButton" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>Email Configuration</button>
          <button class="button" id="openComposerButton" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>Compose Campaign</button>
        </div>
      </div>

      <section class="kpi-grid workspace-page" id="workspaceKpis">
        <div class="kpi-card"><div class="kpi-copy"><span>Total Leads</span><strong id="kpiTotal">0</strong><small id="trendTotal" class="mini-trend">+0 this run</small></div><div class="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></div></div>
        <div class="kpi-card"><div class="kpi-copy"><span>New Leads</span><strong id="kpiNew">0</strong><small id="trendNew" class="mini-trend">Ready for qualification</small></div><div class="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg></div></div>
        <div class="kpi-card"><div class="kpi-copy"><span>Interested</span><strong id="kpiInterested">0</strong><small id="trendInterested" class="mini-trend">+0 high intent</small></div><div class="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"></path></svg></div></div>
        <div class="kpi-card"><div class="kpi-copy"><span>Email Sent</span><strong id="kpiSent">0</strong><small id="trendSent" class="mini-trend">+0 outbound touchpoints</small></div><div class="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg></div></div>
      </section>

      <section class="admin-console admin-only" id="adminConsole" hidden>
        <div class="admin-head">
          <div><h2>Admin Console</h2><p>Theo dõi user, lead và email usage của toàn hệ thống.</p></div>
          <div class="page-actions"><button class="button secondary" id="refreshAdminConsole" type="button">Làm mới</button><button class="button" id="adminCreateFocus" type="button">Tạo user</button></div>
        </div>
        <div class="admin-kpis">
          <div class="admin-kpi"><span>Tổng user</span><strong id="adminTotalUsers">0</strong><small id="adminLockedUsers">0 bị khóa</small></div>
          <div class="admin-kpi"><span>User hoạt động</span><strong id="adminActiveUsers">0</strong><small id="adminAdmins">0 admin</small></div>
          <div class="admin-kpi"><span>Tổng lead</span><strong id="adminLeadTotal">0</strong><small id="adminEmailFound">0 có email</small></div>
          <div class="admin-kpi"><span>Email đã gửi</span><strong id="adminEmailTotal">0</strong><small id="adminEmailLogs">0 log</small></div>
        </div>
        <div class="admin-layout">
          <section class="panel">
            <div class="panel-head"><div><h2>Tạo user mới</h2><span>Cấp tài khoản cho khách hàng sử dụng tool</span></div></div>
            <form id="adminCreateUserForm" class="admin-create-form">
              <div class="field"><label for="adminNewUserName">Tên user</label><input id="adminNewUserName" name="name" placeholder="Tên khách hàng" required></div>
              <div class="field"><label for="adminNewUserEmail">Email đăng nhập</label><input id="adminNewUserEmail" name="email" type="email" placeholder="user@company.com" required></div>
              <div class="field"><label for="adminNewUserPassword">Mật khẩu</label><input id="adminNewUserPassword" name="password" type="password" minlength="8" placeholder="Tối thiểu 8 ký tự" required></div>
              <div class="field"><label for="adminNewUserRole">Quyền</label><select id="adminNewUserRole" name="role"><option value="user">User</option><option value="admin">Admin</option></select></div>
              <button class="button" type="submit">Tạo user</button>
            </form>
          </section>
          <section class="panel">
            <div class="panel-head"><div><h2>Quản lý user</h2><span>Thống kê lead/email và khóa mở tài khoản</span></div></div>
            <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>User</th><th>Trạng thái</th><th>Lead</th><th>Email</th><th>Lần đăng nhập</th><th>Quyền / mật khẩu</th><th>Thao tác</th></tr></thead><tbody id="adminUserRows"></tbody></table></div>
          </section>
        </div>
      </section>

      <div class="workspace-grid workspace-page" id="workspaceGrid">
        <section class="panel search-panel" id="finderPanel">
          <div class="panel-head"><div><h2>Lead Search</h2><span>Nguồn dữ liệu doanh nghiệp</span></div></div>
          <form id="searchForm">
            <div class="field"><label for="keyword">Từ khóa</label><input id="keyword" name="keyword" placeholder="coffee importer, seafood distributor" required></div>
            <div class="field"><label for="location">Địa điểm</label><input id="location" name="location" placeholder="Germany, Tokyo, California" required></div>
            <div class="field"><label for="serpApiKey">SerpAPI Key</label><input id="serpApiKey" name="serpapi_key" type="password" autocomplete="off" placeholder="Dán SerpAPI key vào đây" required></div>
            <div class="check-row api-key-row">
              <label><input id="saveApiKey" type="checkbox"> Lưu API key trên máy này</label>
              <button class="button ghost" id="clearApiKey" type="button">Xóa key</button>
            </div>
            <div class="search-actions primary-search">
              <button class="button" id="searchButton" type="submit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>Tìm lead</button>
              <button class="button secondary" id="saveSearchButton" type="button">Lưu tìm kiếm</button>
            </div>
            <details class="advanced-filters" id="advancedFilters">
              <summary><span>Bộ lọc nâng cao</span><small>Ngành, rating, điểm lead</small></summary>
              <div class="advanced-grid">
                <div class="field"><label for="industry">Ngành</label><input id="industry" name="industry" placeholder="Food, FMCG, logistics"></div>
                <div class="field"><label for="minRating">Rating tối thiểu</label><input id="minRating" name="min_rating" type="number" min="0" max="5" step="0.1" placeholder="4.0"></div>
                <div class="field"><label for="minScore">Điểm lead</label><input id="minScore" name="min_score" type="number" min="0" max="100" placeholder="70"></div>
              </div>
            </details>
            <div class="status-line" id="statusLine"></div>
            <div class="activity-log" id="resultLog" hidden></div>
          </form>
        </section>

        <section class="results-panel" id="pipelinePanel">
          <div class="filter-bar">
            <div class="tabs" id="filterTabs"></div>
            <div class="view-toggle" id="viewToggle" aria-label="Lead view mode">
              <button type="button" data-view="grid">Grid</button>
              <button type="button" data-view="pipeline">Pipeline</button>
            </div>
            <div class="bulk-actions">
              <label class="select-hint"><input id="selectAllLeads" type="checkbox"> Chọn tất cả</label>
              <span class="select-hint" id="selectedCount">0 selected</span>
              <button class="button secondary" id="emailSelectedButton" type="button">Send Email</button>
              <button class="button danger" id="clearLeads" type="button">Delete</button>
            </div>
          </div>
          <div id="leadRows" class="lead-grid"></div>
        </section>
      </div>
    </main>
  </div>

  <div class="drawer-backdrop" id="detailBackdrop"></div>
  <aside class="drawer" id="leadDrawer" aria-hidden="true">
    <div class="drawer-head">
      <div class="drawer-title"><h3 id="drawerCompany">Business profile</h3><span id="drawerSubtitle"></span></div>
      <button class="icon-button" id="closeLeadDrawer" type="button" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>
    </div>
    <div class="drawer-body" id="leadDrawerBody"></div>
  </aside>

  <div class="drawer-backdrop" id="composerBackdrop"></div>
  <aside class="drawer" id="emailComposer" aria-hidden="true">
    <div class="drawer-head">
      <div class="drawer-title"><h3>Email Composer</h3><span id="composerSubtitle">0 selected leads</span></div>
      <button class="icon-button" id="closeComposer" type="button" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>
    </div>
    <div class="drawer-body">
      <div class="field"><label for="templateSelect">Template Selector</label><select id="templateSelect"><option value="custom">Custom</option><option value="cooperation">Cooperation inquiry</option><option value="distribution">Distribution partnership</option><option value="followup">Follow up</option></select></div>
      <div class="field"><label for="emailSubject">Subject</label><input id="emailSubject" placeholder="Cooperation inquiry"></div>
      <div class="field"><label for="emailBody">Body</label><textarea id="emailBody" placeholder="Hello {{name}},&#10;&#10;We are looking for potential import/distribution partners..."></textarea></div>
      <div class="detail-section"><h4>Preview</h4><div id="emailPreview" class="activity-log"></div></div>
      <div class="search-actions"><button class="button secondary" id="sendTestButton" type="button">Send Test</button><button class="button" id="sendEmailButton" type="button">Send Email</button></div>
    </div>
  </aside>

  <div class="modal-backdrop" id="settingsBackdrop"></div>
  <section class="modal" id="settingsModal" aria-hidden="true">
    <div class="modal-head">
      <div><h3>Email Configuration</h3><p>Cấu hình SMTP nằm riêng trong Settings, không chiếm diện tích màn hình tìm lead.</p></div>
      <button class="icon-button" id="closeSettings" type="button" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>
    </div>
    <div class="modal-body">
      <div class="field-row"><div class="field"><label for="smtpHost">SMTP Host</label><input id="smtpHost" placeholder="smtp.gmail.com"></div><div class="field"><label for="smtpPort">Port</label><input id="smtpPort" type="number" value="587"></div></div>
      <div class="check-row"><label><input id="smtpSecure" type="checkbox"> Dùng SSL trực tiếp</label><span class="select-hint">Port 465 thường dùng SSL</span></div>
      <div class="field"><label for="smtpFrom">Email gửi đi</label><input id="smtpFrom" placeholder="you@company.com"></div>
      <div class="field-row"><div class="field"><label for="smtpUser">Email đăng nhập</label><input id="smtpUser" autocomplete="username" placeholder="Để trống nếu giống email gửi đi"></div><div class="field"><label for="smtpPass">Mật khẩu email</label><input id="smtpPass" type="password" autocomplete="current-password" placeholder="Gmail: dùng App Password 16 ký tự"></div></div><p class="select-hint email-pass-hint">Với email công ty/private mail có thể dùng mật khẩu email. Gmail thường chặn mật khẩu thường và yêu cầu App Password.</p>
      <button class="button" id="saveSettingsButton" type="button">Save Configuration</button>
    </div>
  </section>



  <div class="modal-backdrop" id="usersBackdrop"></div>
  <section class="modal" id="usersModal" aria-hidden="true">
    <div class="modal-head">
      <div><h3>Quản lý user</h3><p>Tạo tài khoản và cấp quyền truy cập tool.</p></div>
      <button class="icon-button" id="closeUsers" type="button" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>
    </div>
    <div class="modal-body">
      <form id="createUserForm" class="user-create-grid">
        <div class="field"><label for="newUserName">Tên user</label><input id="newUserName" name="name" placeholder="Rose Hong" required></div>
        <div class="field"><label for="newUserEmail">Email đăng nhập</label><input id="newUserEmail" name="email" type="email" placeholder="user@company.com" required></div>
        <div class="field"><label for="newUserPassword">Mật khẩu</label><input id="newUserPassword" name="password" type="password" minlength="8" placeholder="Tối thiểu 8 ký tự" required></div>
        <div class="field"><label for="newUserRole">Quyền</label><select id="newUserRole" name="role"><option value="user">User</option><option value="admin">Admin</option></select></div>
        <button class="button full" type="submit">Tạo user</button>
      </form>
      <div class="user-list" id="userList"></div>
    </div>
  </section>


  <div class="toast-stack" id="toastStack"></div>

  <script>
    const $ = (selector, scope = document) => scope.querySelector(selector);
    const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
    const authScreen = $("#authScreen");
    const loginForm = $("#loginForm");
    const loginError = $("#loginError");
    const form = $("#searchForm");
    const button = $("#searchButton");
    const statusLine = $("#statusLine");
    const resultLog = $("#resultLog");
    const leadRows = $("#leadRows");
    const selectAllLeads = $("#selectAllLeads");
    const clearLeads = $("#clearLeads");
    const saveApiKey = $("#saveApiKey");
    const clearApiKey = $("#clearApiKey");
      const globalLeadSearch = $("#globalLeadSearch");
    const filterTabs = $("#filterTabs");
    const selectedCount = $("#selectedCount");
    const settingsModal = $("#settingsModal");
    const settingsBackdrop = $("#settingsBackdrop");
    const usersModal = $("#usersModal");
    const usersBackdrop = $("#usersBackdrop");
    const userList = $("#userList");
    const createUserForm = $("#createUserForm");
    const emailComposer = $("#emailComposer");
    const composerBackdrop = $("#composerBackdrop");
    const leadDrawer = $("#leadDrawer");
    const detailBackdrop = $("#detailBackdrop");
    const leadDrawerBody = $("#leadDrawerBody");
    const drawerCompany = $("#drawerCompany");
    const drawerSubtitle = $("#drawerSubtitle");
    const composerSubtitle = $("#composerSubtitle");
    const smtpHost = $("#smtpHost");
    const smtpPort = $("#smtpPort");
    const smtpSecure = $("#smtpSecure");
    const smtpFrom = $("#smtpFrom");
    const smtpUser = $("#smtpUser");
    const smtpPass = $("#smtpPass");
    const emailSubject = $("#emailSubject");
    const emailBody = $("#emailBody");
    const templateSelect = $("#templateSelect");
    const emailPreview = $("#emailPreview");
    const viewToggle = $("#viewToggle");
    const themeToggle = $("#themeToggle");
    const languageToggle = $("#languageToggle");
    const advancedFilters = $("#advancedFilters");
    const logoutButton = $("#logoutButton");
    const currentUserAvatar = $("#currentUserAvatar");
    const adminConsole = $("#adminConsole");
    const adminUserRows = $("#adminUserRows");
    const adminCreateUserForm = $("#adminCreateUserForm");
    const apiKeyStorageKey = "google_maps_lead_scanner_serpapi_key";
    const smtpStorageKey = "google_maps_lead_scanner_smtp_settings";
    const savedSearchKey = "xnk_saved_search";
    const viewModeStorageKey = "xnk_view_mode";
    const themeStorageKey = "xnk_theme";
    const languageStorageKey = "xnk_language";
    let currentLang = localStorage.getItem(languageStorageKey) === "en" ? "en" : "vi";
    let leadPollingTimer = null;
    let currentUser = null;
    let state = { leads: [], selectedLeadIds: new Set(), activeFilter: "all", activeLeadId: null, loading: false, viewMode: localStorage.getItem(viewModeStorageKey) || "grid", draggedLeadId: null, adminSummary: null };
    const statusList = [
      { value: "new", label: "New" },
      { value: "contacted", label: "Contacted" },
      { value: "interested", label: "Interested" },
      { value: "follow_up", label: "Follow Up" },
      { value: "closed", label: "Closed" },
      { value: "lost", label: "Lost" }
    ];
    const legacyStatusMap = { qualified: "interested", replied: "closed", not_fit: "lost" };
    const templates = {
      cooperation: { subject: "Cooperation inquiry", body: "Hello {{name}},\n\nWe are looking for potential import/export partners and would like to explore a cooperation opportunity with {{company}}.\n\nCould you share the right contact person for purchasing or business development?\n\nBest regards," },
      distribution: { subject: "Distribution partnership", body: "Hello {{name}},\n\nI found {{company}} and believe there may be a fit for a distribution/import partnership.\n\nWe would be happy to send more information and discuss potential demand in your market.\n\nBest regards," },
      followup: { subject: "Following up", body: "Hello {{name}},\n\nJust following up on my previous message regarding a potential cooperation with {{company}}.\n\nWould this be relevant for your team?\n\nBest regards," }
    };

    const LANG = {
      vi: {
        brandSub: "Thân tặng chị Rose Hong", global: "Tìm công ty, email, website, địa chỉ", leads: "Lead", email: "Email", interested: "Quan tâm",
        navDash: "Tổng quan", navFinder: "Tìm lead", navPipe: "Pipeline", navCamp: "Chiến dịch email", navTpl: "Mẫu email", navExport: "Xuất file", navSet: "Cài đặt", navUsers: "Người dùng", navAdmin: "Admin Console", logout: "Đăng xuất",
        sideTitle: "CRM XNK Workspace", sideCopy: "Quản lý lead, email outreach và ghi chú trong một dashboard gọn gàng.",
        pageTitle: "Tạo lead & gửi email tiếp cận", pageCopy: "Quét doanh nghiệp, phân loại cơ hội và gửi email tiếp cận trong cùng một không gian CRM.",
        emailConfig: "Cấu hình email", compose: "Soạn chiến dịch", kpiTotal: "Tổng lead", kpiNew: "Lead mới", kpiInt: "Quan tâm", kpiSent: "Email đã gửi",
        leadSearch: "Tìm lead", dataSource: "Nguồn dữ liệu doanh nghiệp", keyword: "Từ khóa", location: "Địa điểm", key: "SerpAPI Key", keyPh: "Dán SerpAPI key vào đây",
        saveKey: "Lưu API key trên máy này", clearKey: "Xóa key", search: "Tìm lead", saveSearch: "Lưu tìm kiếm", adv: "Bộ lọc nâng cao", advHint: "Ngành, rating, điểm lead", industry: "Ngành", rating: "Rating tối thiểu", score: "Điểm lead",
        grid: "Lưới", selectAll: "Chọn tất cả", sendEmail: "Gửi email", del: "Xóa", composer: "Soạn email", selected: "{n} lead đã chọn", template: "Mẫu email", subject: "Tiêu đề", body: "Nội dung", preview: "Xem trước", sendTest: "Gửi thử",
        settings: "Cấu hình email", settingsCopy: "Cấu hình SMTP nằm riêng trong Settings, không chiếm diện tích màn hình tìm lead.", host: "SMTP Host", port: "Cổng", ssl: "Dùng SSL trực tiếp", portHint: "Port 465 thường dùng SSL", from: "Email gửi đi", user: "Email đăng nhập", pass: "Mật khẩu email", passPh: "Gmail: dùng App Password 16 ký tự", saveConfig: "Lưu cấu hình",
        custom: "Tùy chỉnh", coop: "Đề nghị hợp tác", dist: "Hợp tác phân phối", follow: "Nhắc lại", langTitle: "Đã đổi ngôn ngữ", langMsg: "Giao diện đang dùng tiếng Việt."
      },
      en: {
        brandSub: "Dedicated to Rose Hong", global: "Search company, email, website, address", leads: "Leads", email: "Email", interested: "Interested",
        navDash: "Dashboard", navFinder: "Lead Finder", navPipe: "Lead Pipeline", navCamp: "Email Campaigns", navTpl: "Templates", navExport: "Exports", navSet: "Settings", navUsers: "Users", navAdmin: "Admin Console", logout: "Logout",
        sideTitle: "Premium CRM Workspace", sideCopy: "Manage leads, email outreach and notes in one focused dashboard.",
        pageTitle: "Lead Generation & Email Outreach", pageCopy: "Find businesses, qualify opportunities and send outreach emails in one CRM workspace.",
        emailConfig: "Email Configuration", compose: "Compose Campaign", kpiTotal: "Total Leads", kpiNew: "New Leads", kpiInt: "Interested", kpiSent: "Email Sent",
        leadSearch: "Lead Search", dataSource: "Business data source", keyword: "Keyword", location: "Location", key: "SerpAPI Key", keyPh: "Paste SerpAPI key here",
        saveKey: "Save API key on this computer", clearKey: "Clear key", search: "Search leads", saveSearch: "Save search", adv: "Advanced Filters", advHint: "Industry, rating, lead score", industry: "Industry", rating: "Minimum Rating", score: "Lead Score",
        grid: "Grid", selectAll: "Select all", sendEmail: "Send Email", del: "Delete", composer: "Email Composer", selected: "{n} selected lead{s}", template: "Template Selector", subject: "Subject", body: "Body", preview: "Preview", sendTest: "Send Test",
        settings: "Email Configuration", settingsCopy: "SMTP settings live in Settings so lead search stays uncluttered.", host: "SMTP Host", port: "Port", ssl: "Use direct SSL", portHint: "Port 465 usually uses SSL", from: "Sender email", user: "Login email", pass: "Email password", passPh: "Gmail: use a 16-character App Password", saveConfig: "Save Configuration",
        custom: "Custom", coop: "Cooperation inquiry", dist: "Distribution partnership", follow: "Follow up", langTitle: "Language changed", langMsg: "The interface is now in English."
      }
    };
    function L(key, vars = {}) { const text = (LANG[currentLang] && LANG[currentLang][key]) || LANG.en[key] || key; return String(text).replace(/\{(\w+)\}/g, (_m, name) => vars[name] ?? ""); }
    function setText(selector, text) { const element = $(selector); if (element) element.textContent = text; }
    function setPlaceholder(selector, text) { const element = $(selector); if (element) element.setAttribute("placeholder", text); }
    function setButtonText(selector, text) { const element = $(selector); if (!element) return; const iconNode = element.querySelector("svg"); element.textContent = ""; if (iconNode) element.appendChild(iconNode); element.appendChild(document.createTextNode(text)); }
    function setCheckboxLabel(selector, text) { const label = $(selector); if (!label) return; const input = label.querySelector("input"); label.textContent = ""; if (input) label.appendChild(input); label.appendChild(document.createTextNode(" " + text)); }
    function applyLanguage(lang = currentLang, notify = false) {
      currentLang = lang === "en" ? "en" : "vi";
      localStorage.setItem(languageStorageKey, currentLang);
      document.documentElement.lang = currentLang;
      $$('[data-lang-option]').forEach((item) => item.classList.toggle('active', item.dataset.langOption === currentLang));
      if (languageToggle) languageToggle.title = L("langTitle");
      setText(".brand-title span", L("brandSub")); setPlaceholder("#globalLeadSearch", L("global"));
      const top = $$(".top-chip span"); if (top[0]) top[0].textContent = L("leads"); if (top[1]) top[1].textContent = L("email"); if (top[2]) top[2].textContent = L("interested");
      setButtonText('.nav-item[data-nav="dashboard"]', L("navDash")); setButtonText('.nav-item[data-nav="finder"]', L("navFinder")); setButtonText('.nav-item[data-nav="pipeline"]', L("navPipe")); setButtonText("#openComposerNav", L("navCamp")); setButtonText("#templateNav", L("navTpl")); setButtonText('.nav-item[href="/export.xls"]', L("navExport")); setButtonText("#openSettingsNav", L("navSet")); setButtonText("#adminConsoleNav", L("navAdmin")); setButtonText("#logoutButton", L("logout"));
      setText(".sidebar-footer strong", L("sideTitle")); setText(".sidebar-footer span", L("sideCopy")); setText(".page-title h1", L("pageTitle")); setText(".page-title p", L("pageCopy")); setButtonText("#openSettingsButton", L("emailConfig")); setButtonText("#openComposerButton", L("compose"));
      const kpi = $$(".kpi-copy span"); ["kpiTotal","kpiNew","kpiInt","kpiSent"].forEach((key, index) => { if (kpi[index]) kpi[index].textContent = L(key); });
      setText("#finderPanel .panel-head h2", L("leadSearch")); setText("#finderPanel .panel-head span", L("dataSource")); setText('label[for="keyword"]', L("keyword")); setText('label[for="location"]', L("location")); setText('label[for="serpApiKey"]', L("key")); setPlaceholder("#serpApiKey", L("keyPh")); setCheckboxLabel(".api-key-row label", L("saveKey")); setButtonText("#clearApiKey", L("clearKey")); setButtonText("#searchButton", L("search")); setButtonText("#saveSearchButton", L("saveSearch"));
      setText("#advancedFilters summary span", L("adv")); setText("#advancedFilters summary small", L("advHint")); setText('label[for="industry"]', L("industry")); setText('label[for="minRating"]', L("rating")); setText('label[for="minScore"]', L("score"));
      setButtonText('[data-view="grid"]', L("grid")); setButtonText('[data-view="pipeline"]', "Pipeline"); setCheckboxLabel(".bulk-actions label.select-hint", L("selectAll")); setButtonText("#emailSelectedButton", L("sendEmail")); setButtonText("#clearLeads", L("del"));
      setText("#emailComposer .drawer-title h3", L("composer")); updateComposerSubtitle(); setText('label[for="templateSelect"]', L("template")); setText('label[for="emailSubject"]', L("subject")); setText('label[for="emailBody"]', L("body")); setText("#emailComposer .detail-section h4", L("preview")); setButtonText("#sendTestButton", L("sendTest")); setButtonText("#sendEmailButton", L("sendEmail"));
      if (templateSelect?.options?.length) { templateSelect.options[0].textContent = L("custom"); templateSelect.options[1].textContent = L("coop"); templateSelect.options[2].textContent = L("dist"); templateSelect.options[3].textContent = L("follow"); }
      setText("#settingsModal .modal-head h3", L("settings")); setText("#settingsModal .modal-head p", L("settingsCopy")); setText('label[for="smtpHost"]', L("host")); setText('label[for="smtpPort"]', L("port")); setCheckboxLabel("#settingsModal .check-row label", L("ssl")); setText("#settingsModal .select-hint", L("portHint")); setText('label[for="smtpFrom"]', L("from")); setText('label[for="smtpUser"]', L("user")); setText('label[for="smtpPass"]', L("pass")); setPlaceholder("#smtpPass", L("passPh")); setButtonText("#saveSettingsButton", L("saveConfig"));
      if (notify) showToast(L("langTitle"), L("langMsg"), "success");
    }


    async function apiFetch(url, options = {}) {
      const response = await fetch(url, options);
      if (response.status === 401) {
        showLogin();
        throw new Error(currentLang === "vi" ? "Vui lòng đăng nhập." : "Please sign in.");
      }
      return response;
    }
    function userInitials(user) {
      const text = normalizeText(user?.name || user?.email || "U");
      return text.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "U";
    }
    function showLogin() {
      currentUser = null;
      document.body.classList.add("auth-locked");
      authScreen.hidden = false;
      $$(".admin-only").forEach((item) => item.hidden = true);
      if (loginForm) loginForm.email.focus();
    }
    function showApp(user) {
      currentUser = user;
      document.body.classList.remove("auth-locked");
      authScreen.hidden = true;
      if (currentUserAvatar) currentUserAvatar.textContent = userInitials(user);
      $$(".admin-only").forEach((item) => item.hidden = user?.role !== "admin");
      if (user?.role !== "admin" && adminConsole) showWorkspacePage();
      if (user?.role === "admin" && window.location.hash === "#admin") setTimeout(() => showAdminConsole().catch((error) => showToast("Không tải được Admin Console", error.message, "error")), 0);
    }
    async function loadCurrentUser() {
      const response = await fetch("/api/me");
      if (!response.ok) { showLogin(); return null; }
      const data = await response.json();
      showApp(data.user);
      return data.user;
    }
    async function initializeApp() {
      const user = await loadCurrentUser();
      if (!user) return;
      await loadLeads();
      if (window.location.hash === "#admin" && currentUser?.role === "admin") await showAdminConsole();
    }
    async function loadUsers() {
      if (!currentUser || currentUser.role !== "admin") return;
      const response = await apiFetch("/api/users");
      const users = await response.json();
      userList.innerHTML = users.map((user) => '<div class="user-item"><div><strong>' + escapeHtml(user.name || user.email) + '</strong><span>' + escapeHtml(user.email) + ' · <b class="role-pill">' + escapeHtml(user.role) + '</b> · ' + (user.active ? 'Active' : 'Locked') + '</span></div><div class="user-actions"><button class="action-btn" type="button" data-user-action="toggle" data-id="' + escapeHtml(user.id) + '">' + (user.active ? 'Khóa' : 'Mở') + '</button></div></div>').join("") || '<div class="empty-state"><div><strong>Chưa có user</strong><span>Tạo user mới để cấp quyền truy cập.</span></div></div>';
    }
    function openUsers() { if (!currentUser || currentUser.role !== "admin") return; usersModal.classList.add("open"); usersBackdrop.classList.add("open"); usersModal.setAttribute("aria-hidden", "false"); loadUsers(); }
    function closeUsers() { usersModal.classList.remove("open"); usersBackdrop.classList.remove("open"); usersModal.setAttribute("aria-hidden", "true"); }
    function showWorkspacePage() { document.body.classList.remove("admin-force"); if (adminConsole) adminConsole.hidden = true; $$(".workspace-page").forEach((item) => item.hidden = false); }
    function formatDate(value) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(currentLang === "vi" ? "vi-VN" : "en-US", { dateStyle: "short", timeStyle: "short" }); }
    function renderAdminSummary(summary) {
      if (!summary || !adminUserRows) return;
      const totals = summary.totals || {};
      $("#adminTotalUsers").textContent = totals.users || 0; $("#adminLockedUsers").textContent = (totals.locked_users || 0) + " bị khóa";
      $("#adminActiveUsers").textContent = totals.active_users || 0; $("#adminAdmins").textContent = (totals.admins || 0) + " admin";
      $("#adminLeadTotal").textContent = totals.leads || 0; $("#adminEmailFound").textContent = (totals.leads_with_email || 0) + " có email";
      $("#adminEmailTotal").textContent = totals.emails_sent || 0; $("#adminEmailLogs").textContent = (totals.email_logs || 0) + " log";
      const users = Array.isArray(summary.users) ? summary.users : [];
      adminUserRows.innerHTML = users.map((user) => {
        const lockedClass = user.active ? "" : " locked";
        return '<tr data-user-id="' + escapeHtml(user.id) + '"><td><strong>' + escapeHtml(user.name || user.email) + '</strong><small>' + escapeHtml(user.email || "") + '</small></td><td><span class="status-dot' + lockedClass + '">' + (user.active ? "Active" : "Locked") + '</span></td><td><strong>' + Number(user.lead_count || 0) + '</strong><small>' + Number(user.leads_with_email || 0) + ' có email</small></td><td><strong>' + Number(user.email_sent_count || 0) + '</strong><small>' + Number(user.email_log_count || 0) + ' log</small></td><td>' + escapeHtml(formatDate(user.last_login_at)) + '</td><td><div class="admin-row-actions"><select data-admin-role><option value="user" ' + (user.role === "user" ? "selected" : "") + '>User</option><option value="admin" ' + (user.role === "admin" ? "selected" : "") + '>Admin</option></select><input data-admin-password type="password" placeholder="Mật khẩu mới"></div></td><td><div class="admin-row-actions"><button class="action-btn" type="button" data-admin-user-action="save">Lưu</button><button class="action-btn" type="button" data-admin-user-action="toggle">' + (user.active ? "Khóa" : "Mở") + '</button></div></td></tr>';
      }).join("") || '<tr><td colspan="7"><div class="empty-state"><div><strong>Chưa có user</strong><span>Tạo user đầu tiên để cấp quyền truy cập.</span></div></div></td></tr>';
    }
    async function loadAdminSummary() {
      if (!currentUser || currentUser.role !== "admin") return null;
      const response = await apiFetch("/api/admin/summary");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không tải được Admin Console.");
      state.adminSummary = data;
      renderAdminSummary(data);
      return data;
    }
    async function showAdminConsole() {
      if (!currentUser || currentUser.role !== "admin") return;
      document.body.classList.add("admin-force");
      $$(".workspace-page").forEach((item) => item.hidden = true);
      if (adminConsole) { adminConsole.hidden = false; adminConsole.removeAttribute("hidden"); }
      await loadAdminSummary();
      adminConsole?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    async function createUserFromForm(formEl) {
      const payload = Object.fromEntries(new FormData(formEl).entries());
      const response = await apiFetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không tạo được user.");
      formEl.reset();
      await loadUsers();
      if (adminConsole && !adminConsole.hidden) await loadAdminSummary();
      showToast("Đã tạo user", data.email || payload.email, "success");
      return data;
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
    }
    function normalizeText(value) { return String(value || "").trim(); }
    function numberValue(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
    function canonicalStatus(status) { return legacyStatusMap[status] || status || "new"; }
    function statusLabel(status) { const value = canonicalStatus(status); const labels = { vi: { new: "Mới", contacted: "Đã liên hệ", interested: "Quan tâm", follow_up: "Theo dõi", closed: "Đã chốt", lost: "Không phù hợp" }, en: { new: "New", contacted: "Contacted", interested: "Interested", follow_up: "Follow Up", closed: "Closed", lost: "Lost" } }; return (labels[currentLang] && labels[currentLang][value]) || labels.en[value] || labels.en.new; }
    function scoreInfo(score) {
      const value = numberValue(score);
      if (value >= 90) return { label: "HOT LEAD", className: "score-hot" };
      if (value >= 70) return { label: "WARM", className: "score-warm" };
      return { label: "COLD", className: "score-cold" };
    }
    function primaryEmail(lead) {
      const email = normalizeText(lead.email);
      if (!email) return "Không thấy email";
      return email.split(",")[0].trim();
    }
    function leadSearchHaystack(lead) {
      return [lead.name, lead.email, lead.phone, lead.website, lead.address, lead.type, lead.keyword, lead.location].join(" ").toLowerCase();
    }
    function filteredLeads() {
    const query = normalizeText(globalLeadSearch.value).toLowerCase();
      const minRating = numberValue(form.elements.min_rating.value, 0);
      const minScore = numberValue(form.elements.min_score.value, 0);
      return state.leads.filter((lead) => {
        const status = canonicalStatus(lead.customer_status);
        if (state.activeFilter !== "all" && status !== state.activeFilter) return false;
        if (query && !leadSearchHaystack(lead).includes(query)) return false;
        if (minRating && numberValue(lead.rating) < minRating) return false;
        if (minScore && numberValue(lead.score) < minScore) return false;
        return true;
      });
    }
    function showToast(title, message, type = "success") {
      const toast = document.createElement("div");
      toast.className = "toast " + type;
      toast.innerHTML = "<strong>" + escapeHtml(title) + "</strong><span>" + escapeHtml(message) + "</span>";
      $("#toastStack").appendChild(toast);
      setTimeout(() => toast.remove(), 3600);
    }
    function setLoading(isLoading) {
      state.loading = isLoading;
      if (!isLoading) return;
      leadRows.className = "skeleton-grid";
      leadRows.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
    }
    function updateStats() {
      const total = state.leads.length;
      const newCount = state.leads.filter((lead) => canonicalStatus(lead.customer_status) === "new").length;
      const interested = state.leads.filter((lead) => canonicalStatus(lead.customer_status) === "interested").length;
      const sent = state.leads.reduce((sum, lead) => sum + numberValue(lead.email_sent_count), 0);
      const contacted = state.leads.filter((lead) => canonicalStatus(lead.customer_status) === "contacted").length;
      $("#kpiTotal").textContent = total;
      $("#kpiNew").textContent = newCount;
      $("#kpiInterested").textContent = interested;
      $("#kpiSent").textContent = sent;
      $("#trendTotal").textContent = currentLang === "vi" ? "+" + Math.min(total, 12) + " lượt này" : "+" + Math.min(total, 12) + " this run";
      $("#trendNew").textContent = newCount ? (currentLang === "vi" ? newCount + " lead cần xử lý" : newCount + " ready for qualification") : (currentLang === "vi" ? "Sẵn sàng phân loại" : "Ready for qualification");
      $("#trendInterested").textContent = currentLang === "vi" ? "+" + interested + " tiềm năng cao" : "+" + interested + " high intent";
      $("#trendSent").textContent = sent ? "+" + Math.max(1, Math.round((sent / Math.max(total, 1)) * 100)) + "% outreach" : (currentLang === "vi" ? "+0 email tiếp cận" : "+0 outbound touchpoints");
      $("#topLeadCount").textContent = total;
      $("#topInterested").textContent = interested;
      $("#topEmailSent").textContent = sent || contacted;
    }
    function renderTabs() {
      const counts = { all: state.leads.length };
      for (const lead of state.leads) {
        const status = canonicalStatus(lead.customer_status);
        counts[status] = (counts[status] || 0) + 1;
      }
      const tabs = [{ value: "all", label: currentLang === "vi" ? "Tất cả" : "All" }].concat(statusList.map((status) => ({ value: status.value, label: statusLabel(status.value) })));
      filterTabs.innerHTML = tabs.map((tab) => '<button class="tab ' + (state.activeFilter === tab.value ? 'active' : '') + '" type="button" data-filter="' + tab.value + '">' + tab.label + ' <span>' + (counts[tab.value] || 0) + '</span></button>').join("");
    }
    function statusPills(lead) {
      const current = canonicalStatus(lead.customer_status);
      return '<div class="status-list">' + statusList.map((status) => '<button class="status-pill status-' + status.value + ' ' + (current === status.value ? 'active' : '') + '" type="button" data-action="status" data-id="' + lead.id + '" data-status="' + status.value + '">' + statusLabel(status.value) + '</button>').join("") + '</div>';
    }
    function tagsForLead(lead) {
      return [lead.type, lead.keyword, lead.location].filter(Boolean).slice(0, 3).map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>').join("");
    }
    const glyphs = { location: "⌖", phone: "☎", email: "@", star: "★", globe: "↗", mailSend: "✉", map: "⌖", note: "✎" };
    function icon(name) { return '<span class="mini-icon" aria-hidden="true">' + (glyphs[name] || "•") + '</span>'; }
    function companyInitials(name) { const words = normalizeText(name).split(/\s+/).filter(Boolean).slice(0, 2); return (words.map((word) => word[0]).join("") || "XNK").toUpperCase(); }
    function hostnameFromWebsite(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
    function faviconFromWebsite(url) { try { const parsed = new URL(url); return parsed.origin + "/favicon.ico"; } catch { return ""; } }
    function companyAvatar(lead) {
      const initials = companyInitials(lead.name);
      const favicon = lead.website ? faviconFromWebsite(lead.website) : "";
      return '<div class="company-avatar" data-initials="' + escapeHtml(initials) + '">' + (favicon ? '<img src="' + escapeHtml(favicon) + '" alt="" loading="lazy" onerror="this.parentElement.textContent=this.parentElement.dataset.initials;this.remove()">' : escapeHtml(initials)) + '</div>';
    }
    function compactAddress(address) { const parts = normalizeText(address).split(",").map((part) => part.trim()).filter(Boolean); return parts.length > 2 ? parts.slice(-2).join(", ") : (parts.join(", ") || "No address"); }
    function infoItem(name, value, fallback) { const hasValue = Boolean(normalizeText(value)); const text = hasValue ? normalizeText(value) : fallback; return '<div class="info-item ' + (hasValue ? '' : 'muted') + '">' + icon(name) + '<span title="' + escapeHtml(text) + '">' + escapeHtml(text) + '</span></div>'; }
    function scoreBadge(lead) { const score = scoreInfo(lead.score); return '<span class="score-badge ' + score.className + '"><b>' + score.label + '</b><small>Score ' + escapeHtml(lead.score || 0) + '</small></span>'; }
    function renderLeadCard(lead, pipeline = false) {
      const checked = state.selectedLeadIds.has(Number(lead.id)) ? "checked" : "";
      const host = hostnameFromWebsite(lead.website);
      const rating = lead.rating ? String(lead.rating) + (lead.reviews ? " / " + lead.reviews + " reviews" : "") : "";
      return '<article class="lead-card ' + (pipeline ? 'pipeline-card' : '') + '" draggable="true" data-id="' + lead.id + '">' +
        '<div class="lead-top"><input class="lead-checkbox" type="checkbox" data-id="' + lead.id + '" ' + checked + '>' + companyAvatar(lead) + '<div class="company-block"><div class="company-name">' + escapeHtml(lead.name) + '</div><div class="company-meta">' + escapeHtml(compactAddress(lead.address)) + '</div>' + (lead.website ? '<a class="website-link" href="' + escapeHtml(lead.website) + '" target="_blank" rel="noreferrer">' + escapeHtml(host || lead.website) + '</a>' : '<span class="company-meta">No website</span>') + '</div>' + scoreBadge(lead) + '</div>' +
        '<div class="lead-info-row">' + infoItem('location', compactAddress(lead.address), 'No address') + infoItem('phone', lead.phone, 'No phone') + infoItem('email', lead.email ? primaryEmail(lead) : '', 'No email') + infoItem('star', rating, 'No rating') + infoItem('globe', host, 'No website') + '</div>' +
        '<div class="lead-card-footer"><div class="tags">' + tagsForLead(lead) + '</div><div class="card-actions"><button class="action-btn" type="button" data-action="maps" data-id="' + lead.id + '">' + icon('map') + 'Maps</button><button class="action-btn" type="button" data-action="email" data-id="' + lead.id + '">' + icon('mailSend') + 'Email</button><button class="action-btn" type="button" data-action="note" data-id="' + lead.id + '">' + icon('note') + 'Note</button></div></div>' +
        (pipeline ? '' : statusPills(lead)) +
      '</article>';
    }
    function renderPipeline(visible) {
      const grouped = Object.fromEntries(statusList.map((status) => [status.value, []]));
      for (const lead of visible) (grouped[canonicalStatus(lead.customer_status)] || grouped.new).push(lead);
      return statusList.map((status) => '<section class="kanban-column" data-status="' + status.value + '"><div class="kanban-head"><strong>' + statusLabel(status.value) + '</strong><span class="kanban-count">' + (grouped[status.value] || []).length + '</span></div><div class="kanban-items">' + (grouped[status.value] || []).map((lead) => renderLeadCard(lead, true)).join("") + '</div></section>').join("");
    }
    function renderViewToggle() { if (!viewToggle) return; $$('[data-view]', viewToggle).forEach((button) => button.classList.toggle('active', button.dataset.view === state.viewMode)); }
    function renderLeads() {
      if (state.loading) return;
      const visible = filteredLeads();
      selectedCount.textContent = state.selectedLeadIds.size + " selected";
      selectAllLeads.checked = visible.length > 0 && visible.every((lead) => state.selectedLeadIds.has(Number(lead.id)));
      selectAllLeads.indeterminate = state.selectedLeadIds.size > 0 && !selectAllLeads.checked;
      renderViewToggle();
      if (!visible.length) {
        leadRows.className = "";
        const emptyTitle = currentLang === "vi" ? "Không tìm thấy lead phù hợp" : "No matching leads found";
        const emptyCopy = currentLang === "vi" ? "Điều chỉnh bộ lọc hoặc chạy một lượt tìm kiếm mới." : "Adjust filters or run a new search.";
        leadRows.innerHTML = '<div class="empty-state"><div><strong>' + emptyTitle + '</strong><span>' + emptyCopy + '</span></div></div>';
        return;
      }
      if (state.viewMode === "pipeline") {
        leadRows.className = "kanban-board";
        leadRows.innerHTML = renderPipeline(visible);
        return;
      }
      leadRows.className = "lead-grid";
      leadRows.innerHTML = visible.map((lead) => renderLeadCard(lead)).join("");
    }
    async function loadLeads() {
      const response = await apiFetch("/api/leads");
      const leads = await response.json();
      const visibleIds = new Set(leads.map((lead) => Number(lead.id)));
      state.selectedLeadIds = new Set([...state.selectedLeadIds].filter((id) => visibleIds.has(id)));
      state.leads = leads;
      updateStats();
      renderTabs();
      renderLeads();
      updateComposerSubtitle();
      if (state.activeLeadId) renderLeadDrawer(state.activeLeadId);
    }
    async function updateLead(id, patch) {
      const response = await apiFetch("/api/leads/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thỒ cập nhật lead.");
      const index = state.leads.findIndex((lead) => Number(lead.id) === Number(id));
      if (index >= 0) state.leads[index] = { ...state.leads[index], ...data };
      updateStats();
      renderTabs();
      renderLeads();
      return data;
    }
    function openUrl(url) { if (url) window.open(url, "_blank", "noopener,noreferrer"); }
    function openSettings() { settingsModal.classList.add("open"); settingsBackdrop.classList.add("open"); settingsModal.setAttribute("aria-hidden", "false"); }
    function closeSettings() { settingsModal.classList.remove("open"); settingsBackdrop.classList.remove("open"); settingsModal.setAttribute("aria-hidden", "true"); }
    function openComposer() { emailComposer.classList.add("open"); composerBackdrop.classList.add("open"); emailComposer.setAttribute("aria-hidden", "false"); updateComposerSubtitle(); updateEmailPreview(); }
    function closeComposer() { emailComposer.classList.remove("open"); composerBackdrop.classList.remove("open"); emailComposer.setAttribute("aria-hidden", "true"); }
    function openLeadDrawer(id) { state.activeLeadId = Number(id); renderLeadDrawer(id); leadDrawer.classList.add("open"); detailBackdrop.classList.add("open"); leadDrawer.setAttribute("aria-hidden", "false"); }
    function closeLeadDrawer() { state.activeLeadId = null; leadDrawer.classList.remove("open"); detailBackdrop.classList.remove("open"); leadDrawer.setAttribute("aria-hidden", "true"); }
    function leadById(id) { return state.leads.find((lead) => Number(lead.id) === Number(id)); }
    function timelineItems(lead) {
      const items = [
        { title: "Lead imported", detail: lead.created_at || lead.updated_at || "-" },
        { title: "Email scan", detail: lead.email_status || "not scanned" },
        { title: "Status changed to " + statusLabel(lead.customer_status), detail: lead.updated_at || "-" }
      ];
      if (numberValue(lead.email_sent_count)) items.push({ title: "Email sent", detail: String(lead.email_sent_count) + " sent" + (lead.last_email_at ? " · " + lead.last_email_at : "") });
      if (normalizeText(lead.notes)) items.push({ title: "Note added", detail: lead.updated_at || "-" });
      return '<div class="timeline">' + items.map((item) => '<div class="timeline-item"><span class="dot"></span><div><span class="timeline-time">' + escapeHtml(item.detail) + '</span><strong>' + escapeHtml(item.title) + '</strong></div></div>').join("") + '</div>';
    }
    function emailHistory(lead) {
      const logs = Array.isArray(lead.email_history) ? lead.email_history : [];
      if (!logs.length && !numberValue(lead.email_sent_count)) return '<div class="email-entry"><strong>No email activity yet</strong><span>Send a campaign to create history for this lead.</span></div>';
      const renderedLogs = logs.map((log) => '<div class="email-entry"><strong>' + escapeHtml(log.subject || 'Campaign email') + '</strong><span>Sent ' + escapeHtml(log.sent_at || '-') + ' to ' + escapeHtml(log.to || '-') + '</span><span>' + (log.ok === false ? 'Failed: ' + escapeHtml(log.error || 'Unknown error') : 'Opened status unavailable · No reply tracked') + '</span></div>').join("");
      if (renderedLogs) return '<div class="email-history">' + renderedLogs + '</div>';
      return '<div class="email-entry"><strong>Campaign email</strong><span>Sent ' + escapeHtml(lead.last_email_at || '-') + '</span><span>Opened status unavailable · No reply tracked</span></div>';
    }
    function renderLeadDrawer(id) {
      const lead = leadById(id);
      if (!lead) return;
      drawerCompany.textContent = lead.name || "Business profile";
      drawerSubtitle.textContent = lead.website || lead.address || "Lead detail";
      leadDrawerBody.innerHTML =
        '<div class="detail-section"><h4>Company Overview</h4><div class="detail-profile">' + companyAvatar(lead) + '<div><strong>' + escapeHtml(lead.name || 'Unknown company') + '</strong><span class="company-meta">' + escapeHtml(compactAddress(lead.address)) + '</span></div></div><div class="detail-list">' +
        '<div class="detail-row"><span>Website</span><strong>' + (lead.website ? '<a class="website-link" href="' + escapeHtml(lead.website) + '" target="_blank" rel="noreferrer">' + escapeHtml(lead.website) + '</a>' : 'No website') + '</strong></div>' +
        '<div class="detail-row"><span>Address</span><strong>' + escapeHtml(lead.address || '-') + '</strong></div>' +
        '<div class="detail-row"><span>Phone</span><strong>' + escapeHtml(lead.phone || 'No phone') + '</strong></div>' +
        '<div class="detail-row"><span>Email</span><strong>' + escapeHtml(lead.email || 'No email found') + '</strong></div>' +
        '</div></div>' +
        '<div class="detail-section"><h4>Lead Intelligence</h4><div class="detail-list">' +
        '<div class="detail-row"><span>Score</span><strong>' + scoreBadge(lead) + '</strong></div>' +
        '<div class="detail-row"><span>Rating</span><strong>' + escapeHtml(lead.rating || '-') + '</strong></div>' +
        '<div class="detail-row"><span>Review Count</span><strong>' + escapeHtml(lead.reviews || '-') + '</strong></div>' +
        '<div class="detail-row"><span>Category</span><strong>' + escapeHtml(lead.type || '-') + '</strong></div>' +
        '<div class="detail-row"><span>Tags</span><strong><div class="tags">' + tagsForLead(lead) + '</div></strong></div>' +
        '</div></div>' +
        '<div class="detail-section"><h4>Status</h4>' + statusPills(lead) + '</div>' +
        '<div class="detail-section"><h4>Activity Timeline</h4>' + timelineItems(lead) + '</div>' +
        '<div class="detail-section"><h4>Notes</h4><div class="field"><textarea id="drawerNotes" placeholder="Ghi chú về khách hàng này">' + escapeHtml(lead.notes || '') + '</textarea></div><button class="button" type="button" id="saveDrawerNote">Save Note</button></div>' +
        '<div class="detail-section"><h4>Email History</h4>' + emailHistory(lead) + '</div>';
      $("#saveDrawerNote").addEventListener("click", async () => {
        try {
          await updateLead(lead.id, { notes: $("#drawerNotes").value });
          showToast("Đã lưu ghi chú", lead.name || "Lead", "success");
          renderLeadDrawer(lead.id);
        } catch (error) { showToast("Không lưu được", error.message, "error"); }
      });
      $$('[data-action="status"]', leadDrawerBody).forEach((pill) => pill.addEventListener("click", onStatusClick));
    }
    async function onStatusClick(event) {
      event.stopPropagation();
      const id = event.currentTarget.dataset.id;
      const status = event.currentTarget.dataset.status;
      try {
        await updateLead(id, { customer_status: status });
        if (state.activeLeadId) renderLeadDrawer(state.activeLeadId);
        showToast("Status updated", statusLabel(status), "success");
      } catch (error) { showToast("Không cập nhật được", error.message, "error"); }
    }
    async function deleteLeads(ids) {
      const response = await apiFetch("/api/leads", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids || [] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thỒ xóa lead.");
      state.selectedLeadIds.clear();
      await loadLeads();
      showToast("Đã xóa lead", String(data.deleted_count || 0) + " records removed", "success");
    }
    function updateComposerSubtitle() {
      const selected = state.selectedLeadIds.size;
      composerSubtitle.textContent = L("selected", { n: selected, s: selected === 1 ? "" : "s" });
      selectedCount.textContent = L("selected", { n: selected, s: selected === 1 ? "" : "s" });
    }
    function renderEmailTemplate(template, lead) {
      const replacements = { name: lead?.name || "Company", company: lead?.name || "Company", website: lead?.website || "", address: lead?.address || "", phone: lead?.phone || "" };
      return String(template || "").replace(/\{\{\s*(name|company|website|address|phone)\s*\}\}/gi, (_match, key) => replacements[key.toLowerCase()] || "");
    }
    function updateEmailPreview() {
      const firstLead = leadById([...state.selectedLeadIds][0]) || state.leads[0] || {};
      const subject = renderEmailTemplate(emailSubject.value, firstLead);
      const body = renderEmailTemplate(emailBody.value, firstLead);
      emailPreview.textContent = "Subject: " + (subject || "-") + "\n\n" + (body || "-");
    }
    function saveSmtpSettings() {
      localStorage.setItem(smtpStorageKey, JSON.stringify({ host: smtpHost.value.trim(), port: smtpPort.value.trim(), secure: smtpSecure.checked, from: smtpFrom.value.trim(), user: smtpUser.value.trim() }));
    }
    function loadStoredSettings() {
      const savedKey = localStorage.getItem(apiKeyStorageKey);
      if (savedKey) { form.elements.serpapi_key.value = savedKey; saveApiKey.checked = true; }
      try {
        const savedSmtp = JSON.parse(localStorage.getItem(smtpStorageKey) || "{}");
        smtpHost.value = savedSmtp.host || "";
        smtpPort.value = savedSmtp.port || "587";
        smtpSecure.checked = Boolean(savedSmtp.secure);
        smtpFrom.value = savedSmtp.from || "";
        smtpUser.value = savedSmtp.user || "";
      } catch { smtpPort.value = "587"; }
      try {
        const savedSearch = JSON.parse(localStorage.getItem(savedSearchKey) || "{}");
        for (const key of ["keyword", "location", "industry", "min_rating", "min_score"]) if (savedSearch[key] && form.elements[key]) form.elements[key].value = savedSearch[key];
      } catch {}
    }
    function startLeadPolling() {
      clearInterval(leadPollingTimer);
      leadPollingTimer = setInterval(async () => {
        await loadLeads();
        const hasPending = state.leads.some((lead) => lead.email_status === "pending");
        if (!hasPending) { clearInterval(leadPollingTimer); leadPollingTimer = null; statusLine.textContent = "Email scan complete."; }
      }, 2500);
    }
    function applyTheme(theme) {
      const dark = theme === "dark";
      document.body.classList.toggle("theme-dark", dark);
      if (themeToggle) themeToggle.setAttribute("aria-pressed", String(dark));
    }
    function setViewMode(mode) {
      state.viewMode = mode === "pipeline" ? "pipeline" : "grid";
      localStorage.setItem(viewModeStorageKey, state.viewMode);
      renderViewToggle();
      renderLeads();
    }
    filterTabs.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-filter]");
      if (!tab) return;
      state.activeFilter = tab.dataset.filter;
      renderTabs();
      renderLeads();
    });
    if (viewToggle) viewToggle.addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (!button) return;
      setViewMode(button.dataset.view);
    });
    if (languageToggle) languageToggle.addEventListener("click", () => applyLanguage(currentLang === "vi" ? "en" : "vi", true));
    if (themeToggle) themeToggle.addEventListener("click", () => {
      const next = document.body.classList.contains("theme-dark") ? "light" : "dark";
      localStorage.setItem(themeStorageKey, next);
      applyTheme(next);
      showToast(next === "dark" ? "Dark mode" : "Light mode", "Theme updated", "success");
    });
        globalLeadSearch.addEventListener("input", renderLeads);
    form.elements.min_rating.addEventListener("input", renderLeads);
    form.elements.min_score.addEventListener("input", renderLeads);
    leadRows.addEventListener("change", (event) => {
      if (!event.target.matches(".lead-checkbox")) return;
      const id = Number(event.target.dataset.id);
      if (event.target.checked) state.selectedLeadIds.add(id);
      else state.selectedLeadIds.delete(id);
      updateComposerSubtitle();
      renderLeads();
    });
    leadRows.addEventListener("click", async (event) => {
      const statusButton = event.target.closest("[data-action='status']");
      if (statusButton) return onStatusClick({ currentTarget: statusButton, stopPropagation: () => event.stopPropagation() });
      const action = event.target.closest("[data-action]");
      if (action) {
        event.stopPropagation();
        const lead = leadById(action.dataset.id);
        if (!lead) return;
        if (action.dataset.action === "website") openUrl(lead.website);
        if (action.dataset.action === "maps") openUrl(lead.maps_url);
        if (action.dataset.action === "email") { state.selectedLeadIds.add(Number(lead.id)); openComposer(); renderLeads(); }
        if (action.dataset.action === "note") openLeadDrawer(lead.id);
        return;
      }
      if (event.target.closest("a")) return;
      const card = event.target.closest(".lead-card");
      if (card) openLeadDrawer(card.dataset.id);
    });
    leadRows.addEventListener("dragstart", (event) => {
      const card = event.target.closest(".lead-card");
      if (!card) return;
      state.draggedLeadId = Number(card.dataset.id);
      card.classList.add("dragging");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    leadRows.addEventListener("dragend", () => {
      state.draggedLeadId = null;
      $$(".lead-card.dragging").forEach((card) => card.classList.remove("dragging"));
      $$(".kanban-column.drag-over").forEach((column) => column.classList.remove("drag-over"));
    });
    leadRows.addEventListener("dragover", (event) => {
      const column = event.target.closest(".kanban-column");
      if (!column || !state.draggedLeadId) return;
      event.preventDefault();
      $$(".kanban-column.drag-over").forEach((item) => { if (item !== column) item.classList.remove("drag-over"); });
      column.classList.add("drag-over");
    });
    leadRows.addEventListener("dragleave", (event) => {
      const column = event.target.closest(".kanban-column");
      if (column && (!event.relatedTarget || !column.contains(event.relatedTarget))) column.classList.remove("drag-over");
    });
    leadRows.addEventListener("drop", async (event) => {
      const column = event.target.closest(".kanban-column");
      if (!column || !state.draggedLeadId) return;
      event.preventDefault();
      column.classList.remove("drag-over");
      try {
        await updateLead(state.draggedLeadId, { customer_status: column.dataset.status });
        showToast("Pipeline updated", statusLabel(column.dataset.status), "success");
      } catch (error) { showToast("Không cập nhật được", error.message, "error"); }
      finally { state.draggedLeadId = null; }
    });
    selectAllLeads.addEventListener("change", () => {
      const visible = filteredLeads();
      if (selectAllLeads.checked) visible.forEach((lead) => state.selectedLeadIds.add(Number(lead.id)));
      else visible.forEach((lead) => state.selectedLeadIds.delete(Number(lead.id)));
      updateComposerSubtitle();
      renderLeads();
    });
    clearLeads.addEventListener("click", async () => {
      const ids = [...state.selectedLeadIds];
      const message = ids.length ? "Xóa các lead đã chọn?" : "Xóa toàn bộ kết quả hiện tại?";
      if (!confirm(message)) return;
      try { await deleteLeads(ids); } catch (error) { showToast("Không xóa được", error.message, "error"); }
    });
    $("#emailSelectedButton").addEventListener("click", openComposer);
    $("#openComposerButton").addEventListener("click", openComposer);
    $("#openComposerNav").addEventListener("click", openComposer);
    $("#openSettingsButton").addEventListener("click", openSettings);
    $("#openSettingsNav").addEventListener("click", openSettings);
    $("#openUsersButton")?.addEventListener("click", openUsers);
    $("#adminConsoleNav")?.addEventListener("dblclick", openUsers);
    $("#closeUsers")?.addEventListener("click", closeUsers);
    usersBackdrop?.addEventListener("click", closeUsers);
    logoutButton?.addEventListener("click", async () => { await fetch("/api/logout", { method: "POST" }); state.leads = []; state.selectedLeadIds.clear(); renderLeads(); showLogin(); });
    loginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      loginError.textContent = "";
      const loginButton = $("#loginButton");
      loginButton.disabled = true;
      try {
        const payload = Object.fromEntries(new FormData(loginForm).entries());
        const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Không đăng nhập được.");
        showApp(data.user);
        await loadLeads();
        if (window.location.hash === "#admin" && currentUser?.role === "admin") await showAdminConsole();
      } catch (error) { loginError.textContent = error.message; }
      finally { loginButton.disabled = false; }
    });
    createUserForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try { await createUserFromForm(createUserForm); }
      catch (error) { showToast("Không tạo được user", error.message, "error"); }
    });
    adminCreateUserForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try { await createUserFromForm(adminCreateUserForm); }
      catch (error) { showToast("Không tạo được user", error.message, "error"); }
    });
    userList?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-user-action]");
      if (!button) return;
      try {
        const users = await (await apiFetch("/api/users")).json();
        const user = users.find((item) => item.id === button.dataset.id);
        const response = await apiFetch("/api/users/" + button.dataset.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !user?.active }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Không cập nhật được user.");
        await loadUsers();
        if (adminConsole && !adminConsole.hidden) await loadAdminSummary();
      } catch (error) { showToast("Không cập nhật được user", error.message, "error"); }
    });
    adminUserRows?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-admin-user-action]");
      if (!button) return;
      const row = button.closest("tr[data-user-id]");
      if (!row) return;
      const userId = row.dataset.userId;
      const user = state.adminSummary?.users?.find((item) => item.id === userId);
      try {
        const patch = {};
        if (button.dataset.adminUserAction === "toggle") patch.active = !user?.active;
        if (button.dataset.adminUserAction === "save") {
          patch.role = row.querySelector("[data-admin-role]")?.value || "user";
          const password = row.querySelector("[data-admin-password]")?.value || "";
          if (password) patch.password = password;
        }
        const response = await apiFetch("/api/users/" + encodeURIComponent(userId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Không cập nhật được user.");
        await loadUsers(); await loadAdminSummary();
        showToast("Đã cập nhật user", data.email || user?.email || "", "success");
      } catch (error) { showToast("Không cập nhật được user", error.message, "error"); }
    });
    $("#closeSettings").addEventListener("click", closeSettings);
    settingsBackdrop.addEventListener("click", closeSettings);
    $("#closeComposer").addEventListener("click", closeComposer);
    composerBackdrop.addEventListener("click", closeComposer);
    $("#closeLeadDrawer").addEventListener("click", closeLeadDrawer);
    detailBackdrop.addEventListener("click", closeLeadDrawer);
    $("#saveSettingsButton").addEventListener("click", () => { saveSmtpSettings(); closeSettings(); showToast("Đã lưu cấu hình", "SMTP settings đã được lưu trên trình duyệt này.", "success"); });
    for (const input of [smtpHost, smtpPort, smtpFrom, smtpUser]) input.addEventListener("input", saveSmtpSettings);
    smtpSecure.addEventListener("change", saveSmtpSettings);
    saveApiKey.addEventListener("change", () => {
      if (saveApiKey.checked && form.elements.serpapi_key.value.trim()) { localStorage.setItem(apiKeyStorageKey, form.elements.serpapi_key.value.trim()); showToast("Đã lưu API key", "SerpAPI key được lưu trên máy này.", "success"); }
      if (!saveApiKey.checked) { localStorage.removeItem(apiKeyStorageKey); showToast("Đã tắt lưu API key", "Key đã được xóa khỏi trình duyệt.", "success"); }
    });
    form.elements.serpapi_key.addEventListener("input", () => { if (saveApiKey.checked) localStorage.setItem(apiKeyStorageKey, form.elements.serpapi_key.value.trim()); });
    clearApiKey.addEventListener("click", () => { localStorage.removeItem(apiKeyStorageKey); form.elements.serpapi_key.value = ""; saveApiKey.checked = false; showToast("Đã xóa API key", "Bạn có thể nhập key mới khi tìm kiếm.", "success"); });
    $("#saveSearchButton").addEventListener("click", () => {
      localStorage.setItem(savedSearchKey, JSON.stringify({ keyword: form.elements.keyword.value, location: form.elements.location.value, industry: form.elements.industry.value, min_rating: form.elements.min_rating.value, min_score: form.elements.min_score.value }));
      showToast("Search saved", "Bộ lọc tìm kiếm đã được lưu trên máy này.", "success");
    });
    templateSelect.addEventListener("change", () => {
      const selected = templates[templateSelect.value];
      if (selected) { emailSubject.value = selected.subject; emailBody.value = selected.body; }
      updateEmailPreview();
    });
    emailSubject.addEventListener("input", updateEmailPreview);
    emailBody.addEventListener("input", updateEmailPreview);
    $("#sendTestButton").addEventListener("click", () => {
      if (!smtpHost.value.trim() || !smtpFrom.value.trim() || !smtpPass.value.trim()) { openSettings(); showToast("Thiếu cấu hình email", "Nhập host, email gửi đi và mật khẩu email trước khi gửi test.", "error"); return; }
      if (smtpHost.value.trim().includes("@")) { openSettings(); showToast("Sai SMTP Host", "Ô SMTP Host không nhập email. Với Gmail hãy nhập smtp.gmail.com; email nhập ở SMTP Username.", "error"); return; }
      if (/^https?:\/\//i.test(smtpHost.value.trim())) { openSettings(); showToast("Sai SMTP Host", "SMTP Host chỉ nhập tên máy chủ, ví dụ smtp.gmail.com.", "error"); return; }
      showToast("Preview ready", "Nội dung email đã sẵn sàng. Chọn lead và bấm Send Email để gửi thật.", "success");
    });
    $("#sendEmailButton").addEventListener("click", async () => {
      const ids = [...state.selectedLeadIds];
      if (!ids.length) { showToast("Chưa chọn lead", "Tích chọn lead có email trước khi gửi.", "error"); return; }
      if (!smtpHost.value.trim() || !smtpPort.value.trim() || !smtpFrom.value.trim() || !smtpPass.value.trim()) { openSettings(); showToast("Thiếu cấu hình email", "Nhập host, email gửi đi và mật khẩu email trong Settings.", "error"); return; }
      if (smtpHost.value.trim().includes("@")) { openSettings(); showToast("Sai SMTP Host", "Ô SMTP Host không nhập email. Với Gmail hãy nhập smtp.gmail.com; email nhập ở SMTP Username.", "error"); return; }
      if (/^https?:\/\//i.test(smtpHost.value.trim())) { openSettings(); showToast("Sai SMTP Host", "SMTP Host chỉ nhập tên máy chủ, ví dụ smtp.gmail.com.", "error"); return; }
      if (!emailSubject.value.trim() || !emailBody.value.trim()) { showToast("Thiếu nội dung", "Nhập subject và body email.", "error"); return; }
      const sendButton = $("#sendEmailButton");
      sendButton.disabled = true;
      try {
        saveSmtpSettings();
        const response = await apiFetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, smtp: { host: smtpHost.value.trim(), port: smtpPort.value.trim(), secure: smtpSecure.checked, from: smtpFrom.value.trim(), user: smtpUser.value.trim() || smtpFrom.value.trim(), pass: smtpPass.value }, subject: emailSubject.value, body: emailBody.value }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Không gửi được email.");
        showToast("Email sent", "Đã gửi " + data.sent_count + "/" + data.target_count + " email.", "success");
        closeComposer();
        await loadLeads();
      } catch (error) { showToast("Không gửi được email", error.message, "error"); }
      finally { sendButton.disabled = false; }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      if (!String(payload.serpapi_key || "").trim()) { if (advancedFilters) advancedFilters.open = true; statusLine.textContent = "Vui lòng nhập SerpAPI key."; showToast("Thiếu SerpAPI key", "Nhập SerpAPI key trước khi tìm lead.", "error"); return; }
      if (saveApiKey.checked && payload.serpapi_key) localStorage.setItem(apiKeyStorageKey, payload.serpapi_key.trim());
      button.disabled = true;
      statusLine.textContent = "Đang tìm doanh nghiệp và quét email công khai...";
      resultLog.hidden = true;
      setLoading(true);
      try {
        const response = await apiFetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Không thỒ tìm lead.");
        statusLine.textContent = data.saved_count ? "Đã lưu " + data.saved_count + " lead. Email scan đang chạy nền nếu có website." : (data.message || "Không tìm thấy lead phù hợp.");
        resultLog.hidden = false;
        resultLog.textContent = (data.tried_queries && data.tried_queries.length ? "Queries:\n" + data.tried_queries.join("\n") + "\n\n" : "") + (data.results || []).map((item) => "OK " + item.score + "/100 - " + item.name + " - " + (item.phone || "no phone") + " - " + (item.email || item.email_status || "no email")).join("\n");
        state.loading = false;
        await loadLeads();
        showToast("Search complete", String(data.saved_count || 0) + " leads saved", "success");
        if (data.email_scan_started) startLeadPolling();
      } catch (error) {
        state.loading = false;
        renderLeads();
        statusLine.textContent = error.message;
        showToast("Search failed", error.message, "error");
      } finally { button.disabled = false; }
    });
    $$(".nav-item[data-nav]").forEach((item) => item.addEventListener("click", async () => {
      $(".nav-item").forEach((nav) => nav.classList.remove("active"));
      item.classList.add("active");
      if (item.dataset.nav === "admin") { window.location.hash = "admin"; try { await showAdminConsole(); } catch (error) { showToast("Không tải được Admin Console", error.message, "error"); } return; }
      showWorkspacePage();
      if (item.dataset.nav !== "admin") window.location.hash = "";
      if (item.dataset.nav === "dashboard") window.scrollTo({ top: 0, behavior: "smooth" });
      if (item.dataset.nav === "finder") $("#finderPanel").scrollIntoView({ behavior: "smooth", block: "start" });
      if (item.dataset.nav === "pipeline") { setViewMode("pipeline"); $("#pipelinePanel").scrollIntoView({ behavior: "smooth", block: "start" }); }
    }));
    $("#templateNav").addEventListener("click", () => { openComposer(); templateSelect.focus(); });
    $("#refreshAdminConsole")?.addEventListener("click", async () => { try { await loadAdminSummary(); showToast("Admin Console", "Đã làm mới dữ liệu.", "success"); } catch (error) { showToast("Không tải được", error.message, "error"); } });
    $("#adminCreateFocus")?.addEventListener("click", () => { adminCreateUserForm?.scrollIntoView({ behavior: "smooth", block: "center" }); $("#adminNewUserName")?.focus(); });
    applyTheme(localStorage.getItem(themeStorageKey) || "light");
    loadStoredSettings();
    applyLanguage(currentLang);
    renderViewToggle();
    renderTabs();
    updateEmailPreview();
    initializeApp();
  </script>
</body>
</html>


`;


function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return "scrypt$" + salt + "$" + hash;
}

function verifyPassword(password, storedHash = "") {
  const [scheme, salt, expected] = String(storedHash).split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function publicUser(user = {}) {
  return { id: user.id, name: user.name || user.email, email: user.email, role: user.role || "user", active: user.active !== false, created_at: user.created_at || "", updated_at: user.updated_at || "", last_login_at: user.last_login_at || "" };
}

function ownerId(user) {
  return user?.id || DEFAULT_ADMIN_ID;
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function ensureStoreDefaults(store = {}) {
  const now = utcNow();
  const users = Array.isArray(store.users) ? store.users : [];
  if (!users.length) {
    users.push({ id: DEFAULT_ADMIN_ID, name: "Admin", email: DEFAULT_ADMIN_EMAIL, role: "admin", active: true, password_hash: hashPassword(DEFAULT_ADMIN_PASSWORD), created_at: now, updated_at: now });
  }
  const defaultOwner = users.find((user) => user.role === "admin")?.id || users[0]?.id || DEFAULT_ADMIN_ID;
  const leads = Array.isArray(store.leads) ? store.leads : [];
  for (const lead of leads) if (!lead.user_id) lead.user_id = defaultOwner;
  const logs = Array.isArray(store.email_logs) ? store.email_logs : [];
  for (const log of logs) if (!log.user_id) log.user_id = defaultOwner;
  return { nextId: store.nextId || 1, nextUserId: store.nextUserId || users.length + 1, leads, runs: Array.isArray(store.runs) ? store.runs : [], email_logs: logs, users, sessions: Array.isArray(store.sessions) ? store.sessions : [] };
}

function parseCookies(header = "") {
  return Object.fromEntries(String(header || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    if (index === -1) return [part, ""];
    return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function appendSetCookie(response, cookie) {
  const current = response.getHeader("Set-Cookie");
  if (!current) response.setHeader("Set-Cookie", cookie);
  else response.setHeader("Set-Cookie", Array.isArray(current) ? [...current, cookie] : [current, cookie]);
}

function setSessionCookie(request, response, token, maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)) {
  const secure = request.headers["x-forwarded-proto"] === "https" || request.headers["x-forwarded-ssl"] === "on";
  appendSetCookie(response, AUTH_COOKIE_NAME + "=" + encodeURIComponent(token) + "; Path=/; Max-Age=" + maxAgeSeconds + "; HttpOnly; SameSite=Lax" + (secure ? "; Secure" : ""));
}

function clearSessionCookie(response) {
  appendSetCookie(response, AUTH_COOKIE_NAME + "=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
}

async function currentUserFromRequest(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const token = cookies[AUTH_COOKIE_NAME];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const store = await readStore();
  const session = store.sessions.find((item) => item.token_hash === tokenHash);
  if (!session || Date.parse(session.expires_at || "") <= Date.now()) return null;
  const user = store.users.find((item) => item.id === session.user_id && item.active !== false);
  return user ? publicUser(user) : null;
}

async function requireUser(request) {
  const user = await currentUserFromRequest(request);
  if (!user) { const error = new Error("Vui lòng đăng nhập."); error.statusCode = 401; throw error; }
  return user;
}

async function requireAdmin(request) {
  const user = await requireUser(request);
  if (user.role !== "admin") { const error = new Error("Tài khoản này không có quyền quản trị user."); error.statusCode = 403; throw error; }
  return user;
}

async function loginUser(payload = {}, request, response) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  if (!email || !password) throw new Error("Nhập email và mật khẩu.");
  const store = await readStore();
  store.sessions = store.sessions.filter((session) => Date.parse(session.expires_at || "") > Date.now());
  const user = store.users.find((item) => item.email === email && item.active !== false);
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error("Email hoặc mật khẩu không đúng.");
  const token = randomBytes(32).toString("base64url");
  store.sessions.push({ token_hash: hashToken(token), user_id: user.id, created_at: utcNow(), expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
  user.last_login_at = utcNow();
  await writeStore(store);
  setSessionCookie(request, response, token);
  return { user: publicUser(user) };
}

async function logoutUser(request, response) {
  const cookies = parseCookies(request.headers.cookie || "");
  const token = cookies[AUTH_COOKIE_NAME];
  if (token) {
    const tokenHash = hashToken(token);
    const store = await readStore();
    store.sessions = store.sessions.filter((session) => session.token_hash !== tokenHash);
    await writeStore(store);
  }
  clearSessionCookie(response);
  return { ok: true };
}

async function listUsers() {
  const store = await readStore();
  return store.users.map(publicUser).sort((a, b) => a.email.localeCompare(b.email));
}

async function adminSummary() {
  const store = await readStore();
  const users = Array.isArray(store.users) ? store.users : [];
  const emptyUsage = () => ({ lead_count: 0, leads_with_email: 0, email_sent_count: 0, email_log_count: 0, successful_email_count: 0, interested_count: 0, last_lead_at: "" });
  const usage = new Map(users.map((user) => [user.id, emptyUsage()]));
  const getUsage = (userId) => { const id = userId || DEFAULT_ADMIN_ID; if (!usage.has(id)) usage.set(id, emptyUsage()); return usage.get(id); };
  for (const lead of Array.isArray(store.leads) ? store.leads : []) {
    if (lead.source !== "serpapi-google-maps") continue;
    const item = getUsage(lead.user_id);
    item.lead_count += 1;
    if (parseLeadEmails(lead.email).length) item.leads_with_email += 1;
    item.email_sent_count += Number(lead.email_sent_count || 0);
    if ((lead.customer_status || "new") === "interested") item.interested_count += 1;
    const updated = lead.updated_at || lead.created_at || "";
    if (updated && String(updated).localeCompare(String(item.last_lead_at || "")) > 0) item.last_lead_at = updated;
  }
  for (const log of Array.isArray(store.email_logs) ? store.email_logs : []) {
    const item = getUsage(log.user_id);
    item.email_log_count += 1;
    if (log.ok !== false) item.successful_email_count += 1;
  }
  const rows = users.map((user) => ({ ...publicUser(user), ...(usage.get(user.id) || emptyUsage()) })).sort((a, b) => a.email.localeCompare(b.email));
  const totals = rows.reduce((acc, user) => {
    acc.users += 1;
    if (user.active) acc.active_users += 1; else acc.locked_users += 1;
    if (user.role === "admin") acc.admins += 1;
    acc.leads += Number(user.lead_count || 0);
    acc.leads_with_email += Number(user.leads_with_email || 0);
    acc.emails_sent += Number(user.email_sent_count || 0);
    acc.email_logs += Number(user.email_log_count || 0);
    acc.successful_emails += Number(user.successful_email_count || 0);
    return acc;
  }, { users: 0, active_users: 0, locked_users: 0, admins: 0, leads: 0, leads_with_email: 0, emails_sent: 0, email_logs: 0, successful_emails: 0 });
  return { totals, users: rows };
}

async function createUser(payload = {}) {
  const name = normalizeSpace(payload.name || "").slice(0, 80);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const role = payload.role === "admin" ? "admin" : "user";
  if (!name) throw new Error("Nhập tên user.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Email user không hợp lệ.");
  if (password.length < 8) throw new Error("Mật khẩu user cần tối thiểu 8 ký tự.");
  const store = await readStore();
  if (store.users.some((user) => user.email === email)) throw new Error("Email này đã tồn tại.");
  const now = utcNow();
  const user = { id: "u_" + store.nextUserId++, name, email, role, active: true, password_hash: hashPassword(password), created_at: now, updated_at: now };
  store.users.push(user);
  await writeStore(store);
  return publicUser(user);
}

async function updateUser(userId, payload = {}, actingUser) {
  const store = await readStore();
  const user = store.users.find((item) => item.id === userId);
  if (!user) throw new Error("User not found.");
  if (Object.prototype.hasOwnProperty.call(payload, "active")) {
    if (user.id === actingUser.id && payload.active === false) throw new Error("Không thể khóa chính tài khoản đang đăng nhập.");
    user.active = Boolean(payload.active);
  }
  if (payload.role) user.role = payload.role === "admin" ? "admin" : "user";
  if (payload.password) {
    const password = String(payload.password);
    if (password.length < 8) throw new Error("Mật khẩu user cần tối thiểu 8 ký tự.");
    user.password_hash = hashPassword(password);
  }
  if (payload.name) user.name = normalizeSpace(payload.name).slice(0, 80);
  user.updated_at = utcNow();
  await writeStore(store);
  return publicUser(user);
}

function sendError(response, error) {
  sendJson(response, error.statusCode || 400, { error: error instanceof Error ? error.message : String(error) });
}

function normalizeSpace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(rawUrl = "") {
  const value = normalizeSpace(rawUrl);
  if (!value) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return parsed.toString();
  } catch {
    return "";
  }
}

function hostnameFromUrl(rawUrl = "") {
  try {
    return new URL(normalizeUrl(rawUrl)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function shouldSkipEmailScan(website = "") {
  const host = hostnameFromUrl(website);
  return !host || SKIP_EMAIL_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function uniqueValues(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const cleaned = normalizeSpace(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function normalizeEmailText(value = "") {
  return decodeHtmlEntities(value)
    .replace(/\s*(?:\[at\]|\(at\)|\sat\s)\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*/gi, ".");
}

function extractEmails(value = "") {
  const text = normalizeEmailText(value);
  const emails = uniqueValues(text.match(EMAIL_RE) || [])
    .map((email) => email.toLowerCase())
    .filter((email) => {
      if (email.length > 120) return false;
      if (/(example|domain|email|yourname|test)@/i.test(email)) return false;
      if (/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(email)) return false;
      return true;
    });

  const preferred = ["sales@", "export@", "import@", "contact@", "info@", "office@", "hello@"];
  return emails.sort((a, b) => {
    const aRank = preferred.findIndex((prefix) => a.startsWith(prefix));
    const bRank = preferred.findIndex((prefix) => b.startsWith(prefix));
    return (aRank === -1 ? preferred.length : aRank) - (bRank === -1 ? preferred.length : bRank) || a.localeCompare(b);
  });
}

function utcNow() {
  return new Date().toISOString();
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

async function readStore() {
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(STORE_PATH)) return ensureStoreDefaults({ nextId: 1, leads: [], runs: [] });
  const raw = await readFile(STORE_PATH, "utf8");
  return ensureStoreDefaults(JSON.parse(raw));
}

async function writeStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  const tempPath = `${STORE_PATH}.tmp`;
  await writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
  await rename(tempPath, STORE_PATH);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("SerpApi did not return valid JSON");
    }
    if (!response.ok) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    if (payload.error) throw new Error(payload.error);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_PAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 LeadEmailResearchBot/0.2 (public business contact research)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.6"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Response body is not readable");
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PAGE_BYTES) break;
      chunks.push(value);
    }
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } finally {
    clearTimeout(timer);
  }
}

function buildEmailScanUrls(website, rootHtml = "") {
  const normalized = normalizeUrl(website);
  if (!normalized) return [];
  const origin = new URL(normalized).origin;
  const urls = [normalized, ...CONTACT_PATHS.map((path) => `${origin}${path}`)];

  for (const match of rootHtml.matchAll(LINK_RE)) {
    const href = decodeHtmlEntities(match[1] || "").trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    let resolved;
    try {
      resolved = new URL(href, origin);
    } catch {
      continue;
    }
    if (resolved.origin !== origin) continue;
    const path = `${resolved.pathname} ${resolved.search}`.toLowerCase();
    if (!CONTACT_LINK_HINTS.some((hint) => path.includes(hint))) continue;
    resolved.hash = "";
    urls.push(resolved.toString());
  }

  return uniqueValues(urls.map((url) => url.replace(/\/$/, ""))).slice(0, CONTACT_PAGE_LIMIT);
}

async function scanEmailsFromWebsite(website) {
  if (!website) return { email: "", emails: [], pages_scanned: 0 };
  const found = [];
  let pagesScanned = 0;
  let urls = [website];

  try {
    const rootHtml = await fetchTextPage(website);
    pagesScanned += 1;
    found.push(...extractEmails(rootHtml));
    urls = buildEmailScanUrls(website, rootHtml);
  } catch {
    return { email: "", emails: [], pages_scanned: 0 };
  }

  for (const url of urls.slice(1)) {
    try {
      const html = await fetchTextPage(url);
      pagesScanned += 1;
      found.push(...extractEmails(html));
    } catch {
      // Contact/about pages are best-effort only.
    }
  }

  const emails = extractEmails(found.join(" "));
  return {
    email: emails.slice(0, 3).join(", "),
    emails,
    pages_scanned: pagesScanned
  };
}

async function enrichLeadsWithEmails(leads) {
  for (let index = 0; index < leads.length; index += EMAIL_SCAN_CONCURRENCY) {
    const batch = leads.slice(index, index + EMAIL_SCAN_CONCURRENCY);
    await Promise.all(batch.map(async (lead) => {
      if (!lead.website) return;
      const scan = await scanEmailsFromWebsite(lead.website);
      lead.email = scan.email;
      lead.email_pages_scanned = scan.pages_scanned;
      lead.score = scoreResult(lead);
    }));
  }
}

async function updateStoredLeadEmail(targetLead, scan) {
  const store = await readStore();
  const key = leadKey(targetLead);
  const targetOwnerId = targetLead.user_id || DEFAULT_ADMIN_ID;
  const existing = store.leads.find((lead) => lead.source === "serpapi-google-maps" && (lead.user_id || DEFAULT_ADMIN_ID) === targetOwnerId && leadKey(lead) === key);
  if (!existing) return;

  existing.email = scan.email || existing.email || "";
  existing.email_pages_scanned = scan.pages_scanned || 0;
  existing.email_status = scan.status || (scan.email ? "found" : "not_found");
  existing.score = scoreResult(existing);
  existing.updated_at = utcNow();
  await writeStore(store);
}

function startBackgroundEmailScan(leads) {
  const queued = [];
  for (const lead of leads) {
    if (!lead.website || lead.email) continue;
    const key = (lead.user_id || DEFAULT_ADMIN_ID) + ":" + leadKey(lead);
    if (activeEmailJobs.has(key)) continue;
    activeEmailJobs.add(key);
    queued.push(lead);
  }

  if (!queued.length) return 0;

  (async () => {
    for (let index = 0; index < queued.length; index += EMAIL_SCAN_CONCURRENCY) {
      const batch = queued.slice(index, index + EMAIL_SCAN_CONCURRENCY);
      const scans = await Promise.all(batch.map(async (lead) => {
        try {
          if (shouldSkipEmailScan(lead.website)) {
            return { lead, scan: { email: "", pages_scanned: 0, status: "skipped" } };
          }
          const scan = await scanEmailsFromWebsite(lead.website);
          return { lead, scan: { ...scan, status: scan.email ? "found" : "not_found" } };
        } catch {
          return { lead, scan: { email: "", pages_scanned: 0, status: "error" } };
        }
      }));

      for (const { lead, scan } of scans) {
        try {
          await updateStoredLeadEmail(lead, scan);
        } finally {
          activeEmailJobs.delete((lead.user_id || DEFAULT_ADMIN_ID) + ":" + leadKey(lead));
        }
      }
    }
  })().catch((error) => {
    console.error("Background email scan failed:", error);
  });

  return queued.length;
}

function buildQuery(keyword, location) {
  return normalizeSpace(`${keyword} ${location}`);
}

function buildQueryVariants(keyword, location) {
  const cleanKeyword = normalizeSpace(keyword);
  const cleanLocation = normalizeSpace(location);
  return uniqueValues([
    `${cleanKeyword} ${cleanLocation}`,
    `${cleanKeyword} in ${cleanLocation}`,
    `${cleanKeyword} near ${cleanLocation}`,
    `${cleanKeyword} company ${cleanLocation}`,
    `${cleanKeyword} business ${cleanLocation}`
  ].map(normalizeSpace));
}

function isNoResultsError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /hasn'?t returned any results|no results|empty/i.test(message);
}

function googleMapsUrl(lead) {
  const query = normalizeSpace(`${lead.name} ${lead.address}`);
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", query);
  return url.toString();
}

function scoreResult(result) {
  let score = 30;
  if (result.phone) score += 25;
  if (result.website) score += 25;
  if (result.email) score += 20;
  if (result.address) score += 8;
  if (result.rating) score += 5;
  if (Number(result.reviews || 0) > 10) score += 4;
  if (result.description) score += 3;
  return Math.max(0, Math.min(100, score));
}

function normalizeResult(result, keyword, location) {
  const name = normalizeSpace(result.title || result.name || "");
  const address = normalizeSpace(result.address || "");
  const phone = normalizeSpace(result.phone || "");
  const website = normalizeUrl(result.website || "");
  const type = normalizeSpace(result.type || (Array.isArray(result.types) ? result.types[0] : ""));
  const lead = {
    place_id: normalizeSpace(result.place_id || ""),
    data_id: normalizeSpace(result.data_id || ""),
    name: name || "Unknown Company",
    phone,
    website,
    address,
    type,
    rating: result.rating || "",
    reviews: result.reviews || "",
    description: normalizeSpace(result.description || ""),
    email: "",
    email_pages_scanned: 0,
    email_status: website ? "pending" : "no_website",
    customer_status: "new",
    notes: "",
    last_email_at: "",
    email_sent_count: 0,
    keyword,
    location,
    source: "serpapi-google-maps",
    created_at: utcNow(),
    updated_at: utcNow()
  };
  lead.maps_url = googleMapsUrl(lead);
  lead.score = scoreResult(lead);
  return lead;
}

function leadKey(lead) {
  return lead.place_id || lead.data_id || lead.website || `${lead.name}|${lead.address}`.toLowerCase();
}

async function upsertLeads(newLeads, user) {
  const store = await readStore();
  const userId = ownerId(user);
  let saved = 0;
  for (const newLead of newLeads) {
    newLead.user_id = userId;
    const key = leadKey(newLead);
    const existing = store.leads.find((lead) => (lead.user_id || DEFAULT_ADMIN_ID) === userId && leadKey(lead) === key);
    if (existing) {
      Object.assign(existing, {
        ...newLead,
        id: existing.id,
        email: existing.email || newLead.email || "",
        email_pages_scanned: existing.email_pages_scanned || newLead.email_pages_scanned || 0,
        email_status: existing.email ? "found" : (existing.email_status === "found" ? "found" : newLead.email_status),
        customer_status: existing.customer_status || newLead.customer_status || "new",
        notes: existing.notes || newLead.notes || "",
        last_email_at: existing.last_email_at || "",
        email_sent_count: existing.email_sent_count || 0,
        created_at: existing.created_at || newLead.created_at,
        updated_at: utcNow()
      });
    } else {
      store.leads.push({ id: store.nextId++, ...newLead });
    }
    saved += 1;
  }
  store.runs.push({
    id: store.runs.length + 1,
    query: newLeads[0] ? buildQuery(newLeads[0].keyword, newLeads[0].location) : "",
    saved_count: saved,
    created_at: utcNow()
  });
  await writeStore(store);
  return saved;
}

async function searchSerpApiMapsQuery(query, keyword, location, apiKey, seen) {
  const results = [];
  for (let start = 0; start < MAX_RESULTS; start += PAGE_SIZE) {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_maps");
    url.searchParams.set("type", "search");
    url.searchParams.set("q", query);
    url.searchParams.set("start", String(start));
    url.searchParams.set("api_key", apiKey);

    const data = await fetchJson(url);
    const localResults = Array.isArray(data.local_results) ? data.local_results : [];
    if (!localResults.length) break;
    for (const item of localResults) {
      const lead = normalizeResult(item, keyword, location);
      const key = leadKey(lead);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(lead);
    }
    if (!data.serpapi_pagination?.next || localResults.length < PAGE_SIZE) break;
  }
  return results;
}

async function searchSerpApiMaps(payload, user) {
  const keyword = normalizeSpace(payload.keyword);
  const location = normalizeSpace(payload.location);
  const apiKey = normalizeSpace(payload.serpapi_key || process.env.SERPAPI_KEY || "");
  if (!keyword) throw new Error("Vui lòng nhập từ khóa.");
  if (!location) throw new Error("Vui lòng nhập địa điểm.");
  if (!apiKey) throw new Error("Vui lòng nhập SerpApi key.");

  const queryVariants = buildQueryVariants(keyword, location);
  const results = [];
  const seen = new Set();
  const triedQueries = [];
  const ignoredErrors = [];

  for (const query of queryVariants) {
    triedQueries.push(query);
    try {
      const queryResults = await searchSerpApiMapsQuery(query, keyword, location, apiKey, seen);
      results.push(...queryResults);
      if (results.length >= PAGE_SIZE) break;
    } catch (error) {
      if (isNoResultsError(error)) {
        ignoredErrors.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      error.tried_queries = triedQueries;
      throw error;
    }
  }

  if (!results.length) {
    return {
      query: queryVariants[0],
      tried_queries: triedQueries,
      saved_count: 0,
      results: [],
      message: ignoredErrors[0] || "Không tìm thấy kết quả phù hợp cho truy vấn này."
    };
  }

  results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const savedCount = await upsertLeads(results, user);
  const emailScanStarted = startBackgroundEmailScan(results);
  return {
    query: triedQueries[0],
    tried_queries: triedQueries,
    saved_count: savedCount,
    email_scan_started: emailScanStarted,
    results
  };
}

function normalizeStoredLead(lead) {
  return {
    id: lead.id,
    score: Number(lead.score || 0),
    name: lead.name || lead.company_name || "Unknown Company",
    phone: lead.phone || "",
    email: lead.email || "",
    website: lead.website || "",
    address: lead.address || lead.description || "",
    type: lead.type || lead.segment || "",
    rating: lead.rating || "",
    reviews: lead.reviews || lead.user_rating_count || "",
    maps_url: lead.maps_url || "",
    keyword: lead.keyword || lead.product || "",
    location: lead.location || lead.country || "",
    source: lead.source || "",
    email_pages_scanned: lead.email_pages_scanned || 0,
    email_status: lead.email_status || "",
    customer_status: lead.customer_status || "new",
    notes: lead.notes || "",
    last_email_at: lead.last_email_at || "",
    email_sent_count: lead.email_sent_count || 0,
    updated_at: lead.updated_at || "",
    created_at: lead.created_at || ""
  };
}

async function listLeads(user) {
  const store = await readStore();
  const userId = ownerId(user);
  const emailLogs = Array.isArray(store.email_logs) ? store.email_logs : [];
  return store.leads
    .filter((lead) => lead.source === "serpapi-google-maps" && (lead.user_id || DEFAULT_ADMIN_ID) === userId)
    .map((lead) => {
      const normalized = normalizeStoredLead(lead);
      normalized.email_history = emailLogs
        .filter((log) => Number(log.lead_id) === Number(lead.id) && (log.user_id || DEFAULT_ADMIN_ID) === userId)
        .slice(-8)
        .reverse()
        .map((log) => ({
          subject: log.subject || "",
          to: log.to || "",
          sent_at: log.sent_at || "",
          ok: log.ok !== false,
          error: log.error || ""
        }));
      return normalized;
    })
    .sort((a, b) => b.score - a.score || String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 1000);
}

async function deleteGoogleMapsLeads(ids = [], user) {
  const store = await readStore();
  const userId = ownerId(user);
  const before = store.leads.length;
  const idSet = new Set((Array.isArray(ids) ? ids : []).map((id) => Number(id)).filter(Number.isFinite));
  store.leads = store.leads.filter((lead) => {
    if (lead.source !== "serpapi-google-maps") return true;
    if ((lead.user_id || DEFAULT_ADMIN_ID) !== userId) return true;
    if (!idSet.size) return false;
    return !idSet.has(Number(lead.id));
  });
  const deletedCount = before - store.leads.length;
  store.runs.push({
    id: store.runs.length + 1,
    query: idSet.size ? `delete selected serpapi-google-maps leads: ${[...idSet].join(",")}` : "delete serpapi-google-maps leads",
    saved_count: 0,
    deleted_count: deletedCount,
    created_at: utcNow()
  });
  await writeStore(store);
  return deletedCount;
}

async function updateGoogleMapsLead(id, patch = {}, user) {
  const allowedStatuses = new Set(["new", "qualified", "contacted", "replied", "not_fit", "interested", "follow_up", "closed", "lost"]);
  const store = await readStore();
  const userId = ownerId(user);
  const lead = store.leads.find((item) => item.source === "serpapi-google-maps" && (item.user_id || DEFAULT_ADMIN_ID) === userId && Number(item.id) === Number(id));
  if (!lead) throw new Error("Lead not found");

  if (Object.prototype.hasOwnProperty.call(patch, "customer_status")) {
    const status = normalizeSpace(patch.customer_status || "new");
    if (!allowedStatuses.has(status)) throw new Error("Invalid customer status");
    lead.customer_status = status;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "notes")) {
    lead.notes = normalizeSpace(patch.notes).slice(0, 1000);
  }
  lead.updated_at = utcNow();
  await writeStore(store);
  return normalizeStoredLead(lead);
}

function exportColumns() {
  const emailStatusLabels = {
    pending: "Đang quét",
    found: "Đã thấy",
    not_found: "Không thấy",
    skipped: "Bỏ qua",
    no_website: "Không có website",
    error: "Lỗi quét"
  };
  const customerStatusLabels = {
    new: "Mới",
    qualified: "Interested",
    interested: "Interested",
    contacted: "Contacted",
    follow_up: "Follow Up",
    replied: "Closed",
    closed: "Closed",
    not_fit: "Lost",
    lost: "Lost"
  };
  return [
    { header: "STT", value: (_lead, index) => index + 1 },
    { header: "Tên công ty", value: (lead) => lead.name },
    { header: "Số điện thoại", value: (lead) => lead.phone },
    { header: "Email", value: (lead) => lead.email },
    { header: "Trạng thái email", value: (lead) => emailStatusLabels[lead.email_status] || lead.email_status },
    { header: "Trạng thái khách hàng", value: (lead) => customerStatusLabels[lead.customer_status] || lead.customer_status },
    { header: "Ghi chú", value: (lead) => lead.notes },
    { header: "Số lần đã gửi", value: (lead) => lead.email_sent_count },
    { header: "Gửi gần nhất", value: (lead) => lead.last_email_at },
    { header: "Website", value: (lead) => lead.website },
    { header: "Địa chỉ", value: (lead) => lead.address },
    { header: "Loại hình", value: (lead) => lead.type },
    { header: "ĐiỒm", value: (lead) => lead.score },
    { header: "Rating", value: (lead) => lead.rating },
    { header: "Số review", value: (lead) => lead.reviews },
    { header: "Từ khóa", value: (lead) => lead.keyword },
    { header: "Địa điểm", value: (lead) => lead.location },
    { header: "Link bản đồ", value: (lead) => lead.maps_url },
    { header: "Ngày cập nhật", value: (lead) => lead.updated_at }
  ];
}

async function exportExcelHtml(user) {
  const leads = await listLeads(user);
  const columns = exportColumns();
  const headerCells = columns.map((column) => `<th>${htmlEscape(column.header)}</th>`).join("");
  const rows = leads.map((lead, index) => {
    const cells = columns.map((column) => {
      const value = column.value(lead, index);
      const isLink = /^(Website|Link bản đồ)$/.test(column.header) && value;
      return `<td>${isLink ? `<a href="${htmlEscape(value)}">${htmlEscape(value)}</a>` : htmlEscape(value)}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("\n");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; }
    th { background: #0f766e; color: #ffffff; font-weight: 700; }
    th, td { border: 1px solid #b7c4c9; padding: 6px 8px; vertical-align: top; white-space: normal; }
    td { mso-number-format:"\\@"; }
  </style>
</head>
<body>
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function encodeMimeHeader(value = "") {
  const text = String(value || "");
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function base64Body(value = "") {
  return Buffer.from(String(value || ""), "utf8")
    .toString("base64")
    .match(/.{1,76}/g)
    ?.join("\r\n") || "";
}

function parseLeadEmails(value = "") {
  return extractEmails(value).slice(0, 3);
}

function renderEmailTemplate(template = "", lead = {}) {
  const replacements = {
    name: lead.name || "",
    company: lead.name || "",
    website: lead.website || "",
    address: lead.address || "",
    phone: lead.phone || ""
  };
  return String(template || "").replace(/\{\{\s*(name|company|website|address|phone)\s*\}\}/gi, (_match, key) => replacements[key.toLowerCase()] || "");
}

function buildEmailMessage({ from, to, subject, body }) {
  const now = new Date().toUTCString();
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@lead-scanner.local>`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    `Date: ${now}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(body)
  ].join("\r\n");
}

function waitForSocketConnect(socket, eventName) {
  return new Promise((resolve, reject) => {
    const onConnect = () => {
      socket.off("error", onError);
      resolve();
    };
    const onError = (error) => {
      socket.off(eventName, onConnect);
      reject(error);
    };
    socket.once(eventName, onConnect);
    socket.once("error", onError);
  });
}

function createSmtpSession(socket) {
  let currentSocket = socket;
  let buffer = "";
  const waiters = [];

  function extractResponse() {
    const lines = buffer.split(/\r\n/);
    if (lines.length <= 1) return null;
    let consumed = 0;
    for (let index = 0; index < lines.length - 1; index += 1) {
      consumed += lines[index].length + 2;
      if (/^\d{3} /.test(lines[index])) {
        const text = buffer.slice(0, consumed).trimEnd();
        buffer = buffer.slice(consumed);
        const code = Number(lines[index].slice(0, 3));
        return { code, text };
      }
    }
    return null;
  }

  function flushWaiters() {
    while (waiters.length) {
      const response = extractResponse();
      if (!response) break;
      waiters.shift()(response);
    }
  }

  function onData(chunk) {
    buffer += chunk.toString("utf8");
    flushWaiters();
  }

  function attach(nextSocket) {
    if (currentSocket) currentSocket.off("data", onData);
    currentSocket = nextSocket;
    currentSocket.on("data", onData);
  }

  attach(socket);

  function readResponse() {
    const response = extractResponse();
    if (response) return Promise.resolve(response);
    return new Promise((resolve) => waiters.push(resolve));
  }

  async function command(line, expectedCodes) {
    currentSocket.write(`${line}\r\n`);
    const response = await readResponse();
    const expected = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
    if (!expected.includes(response.code)) {
      throw new Error(response.text || `SMTP error ${response.code}`);
    }
    return response;
  }

  async function upgradeToTls(host) {
    currentSocket.off("data", onData);
    const secureSocket = tls.connect({ socket: currentSocket, servername: host });
    secureSocket.setTimeout(REQUEST_TIMEOUT_MS, () => secureSocket.destroy(new Error("SMTP timeout")));
    await waitForSocketConnect(secureSocket, "secureConnect");
    buffer = "";
    attach(secureSocket);
  }

  async function sendMail({ from, to, message }) {
    await command(`MAIL FROM:<${from}>`, [250]);
    await command(`RCPT TO:<${to}>`, [250, 251]);
    await command("DATA", [354]);
    currentSocket.write(`${message.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..")}\r\n.\r\n`);
    await readResponse().then((response) => {
      if (response.code !== 250) throw new Error(response.text || `SMTP error ${response.code}`);
    });
  }

  async function quit() {
    try {
      await command("QUIT", [221]);
    } catch {
      // Ignore quit errors.
    } finally {
      currentSocket.end();
    }
  }

  return { readResponse, command, upgradeToTls, sendMail, quit };
}


function normalizeSmtpConfig(smtp = {}) {
  const host = normalizeSpace(smtp.host);
  const port = Number(smtp.port || 587);
  const secure = Boolean(smtp.secure) || port === 465;
  const from = normalizeSpace(smtp.from);
  const user = normalizeSpace(smtp.user || from);
  const pass = String(smtp.pass || "");
  if (!host || !port || !user || !pass) throw new Error("Thiếu cấu hình email. Hãy nhập host, email gửi đi và mật khẩu email.");
  if (host.includes("@")) {
    throw new Error("Ô SMTP Host đang nhập email. Với Gmail hãy nhập SMTP Host là smtp.gmail.com; email của bạn nhập ở ô Email đăng nhập hoặc Email gửi đi.");
  }
  if (/^https?:\/\//i.test(host)) {
    throw new Error("Ô SMTP Host chỉ nhập tên máy chủ, không nhập http:// hoặc https://. Ví dụ Gmail: smtp.gmail.com.");
  }
  if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes(".")) {
    throw new Error("SMTP Host không hợp lệ. Ví dụ Gmail: smtp.gmail.com, Outlook: smtp.office365.com.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP Port không hợp lệ. Gmail thường dùng 587 hoặc 465.");
  }
  return { host, port, secure, user, pass };
}

function smtpConnectionErrorMessage(error, host) {
  const code = error?.code || "";
  if (["EAI_FAIL", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
    return 'Không tìm thấy SMTP Host "' + host + '". Với Gmail hãy dùng smtp.gmail.com, không dùng địa chỉ email trong ô Host.';
  }
  if (["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) {
    return 'Không kết nối được tới SMTP Host "' + host + '". Kiểm tra Host, Port và mạng Internet.';
  }
  return error instanceof Error ? error.message : String(error);
}

async function openSmtpSession(smtp) {
  const { host, port, secure, user, pass } = normalizeSmtpConfig(smtp);

  const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy(new Error("SMTP timeout")));
  try {
    await waitForSocketConnect(socket, secure ? "secureConnect" : "connect");
  } catch (error) {
    socket.destroy();
    throw new Error(smtpConnectionErrorMessage(error, host));
  }
  const session = createSmtpSession(socket);
  await session.readResponse().then((response) => {
    if (response.code !== 220) throw new Error(response.text || "SMTP server did not greet");
  });

  const ehlo = await session.command("EHLO lead-scanner.local", [250]);
  if (!secure && /STARTTLS/i.test(ehlo.text)) {
    await session.command("STARTTLS", [220]);
    await session.upgradeToTls(host);
    await session.command("EHLO lead-scanner.local", [250]);
  }

  await session.command("AUTH LOGIN", [334]);
  await session.command(Buffer.from(user, "utf8").toString("base64"), [334]);
  await session.command(Buffer.from(pass, "utf8").toString("base64"), [235]);
  return session;
}

async function sendEmailCampaign(payload = {}, user) {
  const ids = new Set((Array.isArray(payload.ids) ? payload.ids : []).map((id) => Number(id)).filter(Number.isFinite));
  if (!ids.size) throw new Error("Chưa chọn lead để gửi email.");
  const smtp = payload.smtp || {};
  const from = normalizeSpace(smtp.from || smtp.user || "");
  const subjectTemplate = normalizeSpace(payload.subject);
  const bodyTemplate = String(payload.body || "").trim();
  if (!from) throw new Error("Thiếu email gửi đi.");
  if (!subjectTemplate || !bodyTemplate) throw new Error("Thiếu tiêu đề hoặc nội dung email.");

  const store = await readStore();
  const userId = ownerId(user);
  store.email_logs = Array.isArray(store.email_logs) ? store.email_logs : [];
  const leads = store.leads.filter((lead) => lead.source === "serpapi-google-maps" && (lead.user_id || DEFAULT_ADMIN_ID) === userId && ids.has(Number(lead.id)));
  const targets = leads.map((lead) => ({ lead, emails: parseLeadEmails(lead.email) })).filter((item) => item.emails.length);
  if (!targets.length) throw new Error("Các lead đã chọn chưa có email hợp lệ.");

  const session = await openSmtpSession(smtp);
  const results = [];
  try {
    for (const target of targets) {
      const to = target.emails[0];
      const subject = renderEmailTemplate(subjectTemplate, target.lead);
      const body = renderEmailTemplate(bodyTemplate, target.lead);
      try {
        await session.sendMail({
          from,
          to,
          message: buildEmailMessage({ from, to, subject, body })
        });
        target.lead.customer_status = "contacted";
        target.lead.last_email_at = utcNow();
        target.lead.email_sent_count = Number(target.lead.email_sent_count || 0) + 1;
        target.lead.updated_at = utcNow();
        store.email_logs.push({
          id: store.email_logs.length + 1,
          lead_id: target.lead.id,
          user_id: userId,
          to,
          subject,
          sent_at: target.lead.last_email_at,
          ok: true
        });
        results.push({ ok: true, id: target.lead.id, name: target.lead.name, email: to });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        store.email_logs.push({
          id: store.email_logs.length + 1,
          lead_id: target.lead.id,
          user_id: userId,
          to,
          subject,
          sent_at: utcNow(),
          ok: false,
          error: message
        });
        results.push({ ok: false, id: target.lead.id, name: target.lead.name, email: to, error: message });
      }
    }
  } finally {
    await session.quit();
  }

  await writeStore(store);
  return {
    target_count: targets.length,
    sent_count: results.filter((item) => item.ok).length,
    results
  };
}

function send(response, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  response.writeHead(status, {
    "Content-Length": Buffer.byteLength(payload),
    ...headers
  });
  response.end(payload);
}

function sendJson(response, status, payload) {
  send(response, status, JSON.stringify(payload), {
    "Content-Type": "application/json; charset=utf-8"
  });
}

function sendText(response, status, text, contentType = "text/plain; charset=utf-8") {
  send(response, status, text, { "Content-Type": contentType });
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === "GET" && url.pathname === "/") {
    sendText(response, 200, INDEX_HTML, "text/html; charset=utf-8");
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, app: APP_NAME, version: APP_VERSION });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/login") {
    try { sendJson(response, 200, await loginUser(await readJsonBody(request), request, response)); }
    catch (error) { sendError(response, error); }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    sendJson(response, 200, await logoutUser(request, response));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/me") {
    const user = await currentUserFromRequest(request);
    if (!user) { sendJson(response, 401, { error: "Vui lòng đăng nhập." }); return; }
    sendJson(response, 200, { user });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users") {
    try { await requireAdmin(request); sendJson(response, 200, await listUsers()); }
    catch (error) { sendError(response, error); }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/users") {
    try { await requireAdmin(request); sendJson(response, 200, await createUser(await readJsonBody(request))); }
    catch (error) { sendError(response, error); }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/summary") {
    try { await requireAdmin(request); sendJson(response, 200, await adminSummary()); }
    catch (error) { sendError(response, error); }
    return;
  }

  const userPatchMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (request.method === "PATCH" && userPatchMatch) {
    try { const actingUser = await requireAdmin(request); sendJson(response, 200, await updateUser(decodeURIComponent(userPatchMatch[1]), await readJsonBody(request), actingUser)); }
    catch (error) { sendError(response, error); }
    return;
  }

  if (request.method === "GET" && (url.pathname === "/export.xls" || url.pathname === "/export.csv")) {
    try {
      const user = await requireUser(request);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      send(response, 200, "﻿" + await exportExcelHtml(user), {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="du-lieu-doanh-nghiep-xnk-${stamp}.xls"`
      });
    } catch (error) { sendError(response, error); }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/leads") {
    try { const user = await requireUser(request); sendJson(response, 200, await listLeads(user)); }
    catch (error) { sendError(response, error); }
    return;
  }

  if (request.method === "DELETE" && url.pathname === "/api/leads") {
    try { const user = await requireUser(request); sendJson(response, 200, { deleted_count: await deleteGoogleMapsLeads((await readJsonBody(request)).ids, user) }); }
    catch (error) { sendError(response, error); }
    return;
  }

  const leadMatch = url.pathname.match(/^\/api\/leads\/(\d+)$/);
  if (request.method === "PATCH" && leadMatch) {
    try { const user = await requireUser(request); sendJson(response, 200, await updateGoogleMapsLead(leadMatch[1], await readJsonBody(request), user)); }
    catch (error) { sendError(response, error); }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/search") {
    try { const user = await requireUser(request); sendJson(response, 200, await searchSerpApiMaps(await readJsonBody(request), user)); }
    catch (error) { sendJson(response, error.statusCode || 400, { error: error instanceof Error ? error.message : String(error), tried_queries: error?.tried_queries || [] }); }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/send-email") {
    try { const user = await requireUser(request); sendJson(response, 200, await sendEmailCampaign(await readJsonBody(request), user)); }
    catch (error) { sendError(response, error); }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

await mkdir(DATA_DIR, { recursive: true });
const server = createServer((request, response) => {
  route(request, response).catch((error) => {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  });
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.log(`${APP_NAME} is already running at ${LOCAL_URL}`);
    openBrowser(LOCAL_URL);
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log(`${APP_NAME} ${APP_VERSION}`);
  console.log(`Data: ${STORE_PATH}`);
  console.log(`Open: ${LOCAL_URL}`);
  openBrowser(LOCAL_URL);
});

