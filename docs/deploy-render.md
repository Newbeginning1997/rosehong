# Deploy Render

Muc tieu: dua tool len internet bang Render Web Service va luu du lieu bang Persistent Disk.

## 1. Chuan bi GitHub

1. Tao repository moi tren GitHub, vi du `quet-du-lieu-doanh-nghiep-xnk`.
2. Push source code len repository do.
3. Khong push cac thu muc `node_modules`, `data`, `build`, `dist`, `release`.

## 2. Tao service tren Render

Cach de nhat: dung Blueprint.

1. Vao Render Dashboard.
2. Chon New > Blueprint.
3. Ket noi GitHub repo cua tool.
4. Render se doc file `render.yaml`.
5. Khi Render hoi bien moi truong bi `sync: false`, nhap:
   - `ADMIN_EMAIL`: email admin that su cua ban.
   - `ADMIN_PASSWORD`: mat khau manh, khong dung `admin123456`.
6. Tao service.

## 3. Cau hinh quan trong

File `render.yaml` da dat san:

```text
HOST=0.0.0.0
OPEN_BROWSER=0
LEAD_SCANNER_DATA_DIR=/var/data
```

Persistent Disk:

```text
mountPath=/var/data
sizeGB=1
```

Render se gan disk vao `/var/data`; tool se tao file du lieu tai `/var/data/data/leads.json`.

## 4. Dang nhap lan dau

Sau khi deploy xong, mo URL Render cap, dang nhap bang:

```text
Email: gia tri ADMIN_EMAIL ban da nhap
Password: gia tri ADMIN_PASSWORD ban da nhap
```

Sau do vao Admin Console de tao tai khoan, khoa/mo user, doi quyen va theo doi lead/email usage cua tung user.

## 5. Canh bao bao mat

- Khong public tool neu con dung mat khau mac dinh.
- Khong chia se SerpApi key hoac SMTP app password.
- Nen gan custom domain va HTTPS truoc khi cho nhieu nguoi dung.
- Ban file JSON phu hop giai doan dau. Neu nhieu user/nhieu lead, nen nang cap sang PostgreSQL va backup tu dong.
