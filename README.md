# User Profile Dashboard

A simple web application that allows users to create profiles, upload photos, and manage their information.

## Features

- User registration and login
- Profile management
- Photo upload functionality
- Responsive design
- SQLite database for data persistence

## Technologies Used

- Node.js
- Express.js
- SQLite3
- HTML/CSS/JavaScript
- Multer (for file uploads)

## Setup Instructions

1. Clone the repository:
```bash
git clone [your-repository-url]
cd [repository-name]
```

2. Install dependencies:
```bash
npm install
```

3. Create required directories:
```bash
mkdir public\uploads
```

4. Start the server:
```bash
node index.js
```

5. Access the application:
- Open your browser and go to `http://localhost:3000`
- Register a new account or login
- Access your dashboard at `http://localhost:3000/dashboard`

## Project Structure

```
├── public/
│   ├── uploads/     # For storing uploaded photos
│   ├── dashboard.html
│   ├── login.html
│   └── register.html
├── index.js         # Main server file
├── users.db         # SQLite database
├── package.json
└── README.md
```

## Dependencies

- express: ^4.18.2
- sqlite3: ^5.1.6
- bcryptjs: ^2.4.3
- jsonwebtoken: ^9.0.0
- multer: ^1.4.5-lts.1
- cors: ^2.8.5
- body-parser: ^1.20.2 