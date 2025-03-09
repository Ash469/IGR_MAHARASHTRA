# IGR Maharashtra Document Search

An automated tool for searching and retrieving property documents from the Maharashtra Inspector General of Registration (IGR) website.

## 📌 Overview

This project provides a user-friendly interface to search for property documents in the Maharashtra IGR database. It consists of:

- **Backend**: A Node.js application using Puppeteer for web automation.
- **Frontend**: A React-based UI for user interaction.

The system automates the process of navigating through the IGR website, handling CAPTCHAs, and downloading property documents based on user inputs.

---

## ✨ Features

✔ Hierarchical search by **District → Taluka → Village → Property Number**  
✔ CAPTCHA handling with user input  
✔ Automatic PDF generation of property documents  
✔ Organized document storage by village name  
✔ Persistent browser sessions for faster searches  

---

## 📁 Project Structure

```
igr-maharashtra/
│
├── backend/                 # Node.js automation server
│   ├── automate.js          # Core automation logic
│   ├── server.js            # Express API server
│   ├── package.json         # Backend dependencies
│   └── documents/           # Downloaded PDFs organized by village
│
├── frontend/                # React-based UI
│   ├── public/              # Static assets
│   ├── src/                 # React source code
│   │   ├── data/            # District/Taluka/Village data
│   │   └── App.js           # Main application component
│   └── package.json         # Frontend dependencies
```

---

## ⚙ Prerequisites

- **Node.js (v14+)**
- **NPM or Yarn**
- **Google Chrome browser installed**

---

## 🚀 Installation

### Backend Setup

1. Clone the repository:
   ```sh
   git clone https://github.com/yourusername/igr-maharashtra.git
   cd igr-maharashtra/backend
   ```

2. Install dependencies:
   ```sh
   npm install
   ```

3. Start the server:
   ```sh
   npm run dev
   ```
   The backend server will start on **http://localhost:3000**

### Frontend Setup

1. Navigate to the frontend directory:
   ```sh
   cd ../frontend
   ```

2. Install dependencies:
   ```sh
   npm install
   ```

3. Start the development server:
   ```sh
   npm start
   ```
   The frontend will be available at **http://localhost:3001**

---

## 🛠 Usage

### 1️⃣ Select Search Parameters
- Choose the **year**
- Select a **district**
- Select a **taluka**
- Select a **village**
- Enter the **property number**

### 2️⃣ Handle CAPTCHA
- When prompted, enter the CAPTCHA text shown on screen
- Submit to continue the search

### 3️⃣ View Results
- Results will be displayed on screen
- PDF documents will be downloaded to the `backend/documents/{village-name}/` folder

---

## 📡 Backend API Endpoints

| Method | Endpoint                     | Description                         |
|--------|------------------------------|-------------------------------------|
| GET    | `/initialize`                 | Get initial form data (years, districts) |
| GET    | `/talukas/:district`         | Get talukas for a district         |
| GET    | `/villages/:district/:taluka`| Get villages for a taluka          |
| POST   | `/search`                    | Perform property search            |
| GET    | `/captcha-image`             | Get current CAPTCHA image          |
| POST   | `/submit-captcha`            | Submit CAPTCHA solution            |

---

## 🔑 Key Components

- **Browser Automation**: Implemented using **Puppeteer** in `automate.js`
- **CAPTCHA Handling**: Captures CAPTCHA images and processes user input
- **Document Download**: Automatically downloads and saves property documents as PDFs

---

## ❓ Troubleshooting

🔹 **CAPTCHA Not Loading**: Check if the backend server is running and accessible.  
🔹 **Document Download Failed**: Ensure the `documents` directory exists and has write permissions.  
🔹 **Search Not Working**: Try clearing the browser automation session using the frontend controls.  

---

## 🤝 Contributing

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Commit your changes** (`git commit -m 'Add some amazing feature'`)
4. **Push to the branch** (`git push origin feature/amazing-feature`)
5. **Open a Pull Request**

---

## 📜 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙌 Acknowledgments

- **Maharashtra IGR** for providing the document search service.
- **Puppeteer** team for the browser automation library.
- **React** community for the frontend framework.

---
