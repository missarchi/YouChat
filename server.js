const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'youchat',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Create users table if it doesn't exist
async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        firstName VARCHAR(50) NOT NULL,
        lastName VARCHAR(50) NOT NULL,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    connection.release();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

initializeDatabase();

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve login and register pages
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Registration endpoint
app.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, username, password } = req.body;

    // Check if user already exists
    const [existingUsers] = await pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const [result] = await pool.query(
      'INSERT INTO users (firstName, lastName, username, password) VALUES (?, ?, ?, ?)',
      [firstName, lastName, username, hashedPassword]
    );

    // Create JWT token
    const token = jwt.sign(
      { 
        userId: result.insertId,
        firstName,
        lastName,
        username
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'Registration successful',
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Error during registration' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Get user from database
    const [users] = await pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );

    if (users.length === 0) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const user = users[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Create JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Error during login' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 