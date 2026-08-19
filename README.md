# GT Library

GT Library is a digital library system with a Node.js/Express backend, MySQL database, and an S3-hosted frontend. It supports secure uploads and role-based access.

---

## 🚀 Quickstart

### Backend (EC2)
```bash
cd backend
npm install --omit=dev
cp .env.example .env   # fill in DB + secrets
node server.js         # test run
