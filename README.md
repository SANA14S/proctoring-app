# 🎥 AI-Powered Proctoring System

## 📌 Overview
This project is a **video proctoring system** that ensures candidates stay focused during online interviews/exams.  
It uses **TensorFlow.js, BlazeFace, and Coco-SSD models** to detect:
- 👀 Candidate’s face presence  
- 🔄 Focus/attention  
- 🚫 Unauthorized objects (like phone or multiple persons)  

The system logs all suspicious events for further review.

---

## ⚡ Features
- ✅ Real-time face detection using **BlazeFace**
- ✅ Object detection using **Coco-SSD**
- ✅ Event logging (focus away, multiple persons, etc.)
- ✅ Backend API for storing logs
- ✅ Frontend built with **React + Vite**
- ✅ Backend built with **Node.js + Express**

---

## 🏗️ Tech Stack
**Frontend:**
- React (Vite)
- TypeScript
- TensorFlow.js
- Sonner (toast notifications)

**Backend:**
- Node.js
- Express
- MongoDB (for log storage)

---


proctoring-app/
│── proctor-frontend/ # React + Vite frontend
│── proctor-backend/ # Express backend


---

## 🚀 Installation & Setup

### 1️⃣ Clone the Repository
``bash
git clone https://github.com/your-username/proctoring-app.git
cd proctoring-app

2️⃣ Setup Backend
cd proctor-backend
npm install
node server.js


By default, backend runs at: http://localhost:4000

3️⃣ Setup Frontend
cd ../proctor-frontend
npm install
npm run dev


Frontend runs at: http://localhost:5173

📝 Usage

Start backend (node server.js)

Start frontend (npm run dev)

Open browser → http://localhost:5173

Grant camera permission → Proctoring starts

Logs are saved to backend for review

📸 Screenshots



🛠️ Future Improvements

Add voice detection for suspicious audio

Admin dashboard for reviewing logs

Deploy on cloud (Vercel + Render/Heroku)

👩‍💻 Author

Developed by Jyotsana Singh ✨
📧 Contact: singhjyotsana1407@example.com




---

