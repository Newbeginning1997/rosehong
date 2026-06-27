(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const keys = { leads: 'xnk_netlify_leads_v1', selected: 'xnk_netlify_selected_v1', api: 'xnk_netlify_serpapi_key', search: 'xnk_netlify_saved_search', access: 'xnk_netlify_access_password' };
  const state = { leads: [], selected: new Set(), loading: false };
  const clean = (v) => String(v || '').trim();
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const normalizePhone = (phone) => clean(phone).replace(/^00/, '').replace(/\D/g, '');
  const hostName = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const toast = (title, msg) => {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(msg || '') + '</span>';
    $('#toastWrap').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  };
  const save = () => {
    localStorage.setItem(keys.leads, JSON.stringify(state.leads));
    localStorage.setItem(keys.selected, JSON.stringify([...state.selected]));
  };
  const load = () => {
    try { state.leads = JSON.parse(localStorage.getItem(keys.leads) || '[]'); } catch { state.leads = []; }
    try { state.selected = new Set(JSON.parse(localStorage.getItem(keys.selected) || '[]').map(Number)); } catch { state.selected = new Set(); }
    const savedKey = localStorage.getItem(keys.api);
    if (savedKey) { $('#serpapiKey').value = savedKey; $('#saveApiKey').checked = true; }
    try {
      const savedSearch = JSON.parse(localStorage.getItem(keys.search) || '{}');
      $('#keyword').value = savedSearch.keyword || '';
      $('#location').value = savedSearch.location || '';
      $('#minRating').value = savedSearch.minRating || '';
      $('#minScore').value = savedSearch.minScore || '';
    } catch {}
    const access = localStorage.getItem(keys.access);
    if (access) $('#accessPassword').value = access;
  };
  const filtered = () => {
    const text = clean($('#globalFilter').value).toLowerCase();
    const status = $('#statusFilter').value;
    const minRating = Number($('#minRating').value || 0);
    const minScore = Number($('#minScore').value || 0);
    let rows = state.leads.filter((lead) => {
      const hay = [lead.name, lead.phone, lead.email, lead.website, lead.address, lead.type, lead.keyword, lead.location].join(' ').toLowerCase();
      if (text && !hay.includes(text)) return false;
      if (status === 'selected' && !state.selected.has(Number(lead.id))) return false;
      if (status === 'phone' && !clean(lead.phone)) return false;
      if (status === 'website' && !clean(lead.website)) return false;
      if (minRating && Number(lead.rating || 0) < minRating) return false;
      if (minScore && Number(lead.score || 0) < minScore) return false;
      return true;
    });
    const sortBy = $('#sortBy').value;
    rows.sort((a,b) => sortBy === 'name' ? clean(a.name).localeCompare(clean(b.name)) : sortBy === 'rating' ? Number(b.rating||0)-Number(a.rating||0) : Number(b.score||0)-Number(a.score||0));
    return rows;
  };
  const updateStats = () => {
    $('#totalLead').textContent = state.leads.length;
    $('#selectedLead').textContent = state.selected.size;
    $('#phoneLead').textContent = state.leads.filter(x => clean(x.phone)).length;
  };
  const openZalo = (phone) => {
    const p = normalizePhone(phone);
    if (!p) { toast('Không có số điện thoại', 'Lead này chưa có phone.'); return; }
    const appUrl = 'zalo://conversation?phone=' + encodeURIComponent(p);
    const webUrl = 'https://zalo.me/' + encodeURIComponent(p);
    toast('Đang mở Zalo', p);
    window.location.href = appUrl;
    setTimeout(() => { if (!document.hidden) window.open(webUrl, '_blank', 'noopener,noreferrer'); }, 1200);
  };
  const render = () => {
    updateStats();
    const rows = filtered();
    $('#selectAll').checked = rows.length > 0 && rows.every(x => state.selected.has(Number(x.id)));
    if (!rows.length) { $('#cards').innerHTML = '<div class="empty">Không có lead phù hợp bộ lọc.</div>'; return; }
    $('#cards').innerHTML = rows.map((lead) => {
      const checked = state.selected.has(Number(lead.id)) ? 'checked' : '';
      const phone = clean(lead.phone);
      const web = clean(lead.website);
      const host = hostName(web) || web;
      return '<article class="card" data-id="' + escapeHtml(lead.id) + '"><div class="card-top"><input class="lead-check" type="checkbox" data-id="' + escapeHtml(lead.id) + '" ' + checked + '><div><h3>' + escapeHtml(lead.name || 'Unknown company') + '</h3><div class="meta">' + escapeHtml(lead.address || 'Không có địa chỉ') + '</div>' + (web ? '<a class="site" href="' + escapeHtml(web) + '" target="_blank" rel="noreferrer">' + escapeHtml(host) + '</a>' : '<div class="meta">Không có website</div>') + '</div><div class="score">' + Number(lead.score || 0) + '/100</div></div><div class="facts"><div class="fact">☎ <span title="' + escapeHtml(phone || 'Không có phone') + '">' + escapeHtml(phone || 'Không có phone') + '</span>' + (phone ? '<button class="zalo" data-action="zalo" data-phone="' + escapeHtml(phone) + '" type="button">Zalo</button>' : '') + '</div><div class="fact">★ <span>' + escapeHtml((lead.rating || '-') + (lead.reviews ? ' / ' + lead.reviews : '')) + '</span></div><div class="fact">@ <span>' + escapeHtml(lead.email || 'Không quét email') + '</span></div><div class="fact">⌖ <span>' + escapeHtml(lead.type || 'Business') + '</span></div></div><div class="tags"><span class="tag">' + escapeHtml(lead.keyword || 'keyword') + '</span><span class="tag">' + escapeHtml(lead.location || 'location') + '</span></div><div class="card-actions"><button class="small" data-action="maps" data-url="' + escapeHtml(lead.maps_url || '') + '" type="button">Maps</button>' + (web ? '<button class="small" data-action="website" data-url="' + escapeHtml(web) + '" type="button">Website</button>' : '') + '<button class="small" data-action="copy" data-id="' + escapeHtml(lead.id) + '" type="button">Copy</button></div></article>';
    }).join('');
  };
  const toRows = (onlySelected = false) => (onlySelected ? state.leads.filter(x => state.selected.has(Number(x.id))) : filtered());
  const columns = [
    ['STT', (_x,i)=>i+1], ['Tên công ty', x=>x.name], ['Số điện thoại', x=>x.phone], ['Email', x=>x.email], ['Website', x=>x.website], ['Địa chỉ', x=>x.address], ['Loại hình', x=>x.type], ['Điểm', x=>x.score], ['Rating', x=>x.rating], ['Số review', x=>x.reviews], ['Từ khóa', x=>x.keyword], ['Địa điểm', x=>x.location], ['Link Google Maps', x=>x.maps_url], ['Ngày cập nhật', x=>x.updated_at]
  ];
  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };
  const exportCsv = (onlySelected = false) => {
    const rows = toRows(onlySelected);
    if (!rows.length) return toast('Không có dữ liệu', 'Không có lead để xuất.');
    const csv = [columns.map(c=>c[0]), ...rows.map((row,i)=>columns.map(c=>String(c[1](row,i) ?? '').replace(/"/g,'""')))].map(r=>r.map(v=>'"'+v+'"').join(',')).join('\r\n');
    download(new Blob(['\ufeff' + csv], { type:'text/csv;charset=utf-8' }), 'xnk-leads.csv');
  };
  const exportXls = (onlySelected = false) => {
    const rows = toRows(onlySelected);
    if (!rows.length) return toast('Không có dữ liệu', 'Không có lead để xuất.');
    const table = '<table><thead><tr>' + columns.map(c=>'<th>'+escapeHtml(c[0])+'</th>').join('') + '</tr></thead><tbody>' + rows.map((row,i)=>'<tr>' + columns.map(c=>'<td>'+escapeHtml(c[1](row,i) ?? '')+'</td>').join('') + '</tr>').join('') + '</tbody></table>';
    download(new Blob(['\ufeff<html><head><meta charset="utf-8"></head><body>' + table + '</body></html>'], { type:'application/vnd.ms-excel;charset=utf-8' }), 'xnk-leads.xls');
  };
  $('#searchForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.loading) return;
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    if ($('#saveApiKey').checked) localStorage.setItem(keys.api, clean(payload.serpapi_key)); else localStorage.removeItem(keys.api);
    state.loading = true; $('#searchButton').disabled = true; $('#log').textContent = 'Đang gọi SerpApi...';
    try {
      const res = await fetch('/api/search', { method:'POST', headers:{ 'Content-Type':'application/json', 'x-access-password': localStorage.getItem(keys.access) || '' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không tìm được lead.');
      const oldKeys = new Set(state.leads.map(x => x.place_id || x.data_id || x.website || (x.name + '|' + x.address).toLowerCase()));
      let added = 0;
      for (const lead of data.results || []) {
        const key = lead.place_id || lead.data_id || lead.website || (lead.name + '|' + lead.address).toLowerCase();
        if (!oldKeys.has(key)) { state.leads.push(lead); oldKeys.add(key); added++; }
      }
      save(); render();
      $('#log').textContent = 'Đã tìm ' + (data.results || []).length + ' lead. Thêm mới ' + added + ' lead.\nQuery: ' + (data.query || '');
      toast('Tìm lead xong', 'Đã thêm ' + added + ' lead mới.');
    } catch (err) { $('#log').textContent = err.message; toast('Không tìm được lead', err.message); }
    finally { state.loading = false; $('#searchButton').disabled = false; }
  });
  $('#cards').addEventListener('change', e => {
    if (!e.target.matches('.lead-check')) return;
    const id = Number(e.target.dataset.id);
    e.target.checked ? state.selected.add(id) : state.selected.delete(id);
    save(); render();
  });
  $('#cards').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'zalo') openZalo(btn.dataset.phone);
    if (action === 'maps' || action === 'website') window.open(btn.dataset.url, '_blank', 'noopener,noreferrer');
    if (action === 'copy') {
      const lead = state.leads.find(x => Number(x.id) === Number(btn.dataset.id));
      navigator.clipboard?.writeText([lead?.name, lead?.phone, lead?.website, lead?.address].filter(Boolean).join('\n'));
      toast('Đã copy', lead?.name || 'Lead');
    }
  });
  $('#selectAll').addEventListener('change', e => { filtered().forEach(x => e.target.checked ? state.selected.add(Number(x.id)) : state.selected.delete(Number(x.id))); save(); render(); });
  $('#deleteSelected').addEventListener('click', () => { const before = state.leads.length; state.leads = state.leads.filter(x => !state.selected.has(Number(x.id))); state.selected.clear(); save(); render(); toast('Đã xóa', 'Xóa ' + (before - state.leads.length) + ' lead.'); });
  $('#clearResults').addEventListener('click', () => { state.leads = []; state.selected.clear(); save(); render(); toast('Đã xóa kết quả', 'Trình duyệt đã sạch dữ liệu lead.'); });
  $('#clearNav').addEventListener('click', () => $('#clearResults').click());
  $('#exportNav').addEventListener('click', () => exportXls(false));
  $('#exportCsv').addEventListener('click', () => exportCsv(false));
  $('#exportXls').addEventListener('click', () => exportXls(false));
  ['globalFilter','statusFilter','sortBy','minRating','minScore'].forEach(id => $('#'+id).addEventListener('input', render));
  $('#saveSearch').addEventListener('click', () => { localStorage.setItem(keys.search, JSON.stringify({ keyword: $('#keyword').value, location: $('#location').value, minRating: $('#minRating').value, minScore: $('#minScore').value })); toast('Đã lưu tìm kiếm', 'Lưu trên trình duyệt này.'); });
  $('#clearKey').addEventListener('click', () => { localStorage.removeItem(keys.api); $('#serpapiKey').value = ''; $('#saveApiKey').checked = false; toast('Đã xóa API key', 'Key đã được xóa khỏi trình duyệt.'); });
  $('#gateForm').addEventListener('submit', e => { e.preventDefault(); localStorage.setItem(keys.access, $('#accessPassword').value); $('#gate').classList.remove('open'); toast('Đã lưu mật khẩu truy cập', 'Mật khẩu chỉ lưu trên trình duyệt.'); });
  $('#skipGate').addEventListener('click', () => { localStorage.removeItem(keys.access); $('#accessPassword').value = ''; $('#gate').classList.remove('open'); });
  load(); render(); $('#gate').classList.add('open');
})();
