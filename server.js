const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const path = require('path');
const session = require('express-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

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

        // Create chats table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS chats (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                createdBy INT NOT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (createdBy) REFERENCES users(id)
            )
        `);

        // Create messages table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                chatId INT NOT NULL,
                senderId INT NOT NULL,
                content TEXT NOT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chatId) REFERENCES chats(id),
                FOREIGN KEY (senderId) REFERENCES users(id)
            )
        `);

        // Create chat participants table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS chat_participants (
                id INT AUTO_INCREMENT PRIMARY KEY,
                chatId INT NOT NULL,
                userId INT NOT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chatId) REFERENCES chats(id),
                FOREIGN KEY (userId) REFERENCES users(id),
                UNIQUE KEY unique_participant (chatId, userId)
            )
        `);

        connection.release();
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
    }
}

initializeDatabase();

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ message: 'Authentication required' });
    }
};

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

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Add chat routes
app.get('/chat', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Get chats endpoint
app.get('/get-chats', requireAuth, async (req, res) => {
    try {
        const [chats] = await pool.query(`
            SELECT c.*, 
                   u.username as createdByUsername,
                   (SELECT content FROM messages WHERE chatId = c.id ORDER BY createdAt DESC LIMIT 1) as lastMessage
            FROM chats c
            JOIN chat_participants cp ON c.id = cp.chatId
            JOIN users u ON c.createdBy = u.id
            WHERE cp.userId = ?
            ORDER BY c.createdAt DESC
        `, [req.session.userId]);

        res.json(chats);
    } catch (error) {
        console.error('Get chats error:', error);
        res.status(500).json({ message: 'Error getting chats' });
    }
});

// Create new chat endpoint
app.post('/create-chat', requireAuth, async (req, res) => {
    try {
        const { name, userId } = req.body;
        
        // Start transaction
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Create new chat
            const [chatResult] = await connection.query(
                'INSERT INTO chats (name, createdBy) VALUES (?, ?)',
                [name, req.session.userId]
            );

            const chatId = chatResult.insertId;

            // Add both users as participants
            await connection.query(
                'INSERT INTO chat_participants (chatId, userId) VALUES (?, ?), (?, ?)',
                [chatId, req.session.userId, chatId, userId]
            );

            await connection.commit();
            connection.release();

            res.status(201).json({
                id: chatId,
                name,
                message: 'Chat created successfully'
            });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (error) {
        console.error('Create chat error:', error);
        res.status(500).json({ message: 'Error creating chat' });
    }
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

        // Get the created user's data
        const [newUser] = await pool.query(
            'SELECT id, firstName, lastName, username FROM users WHERE id = ?',
            [result.insertId]
        );

        // Set session
        req.session.userId = result.insertId;
        req.session.username = username;

        // Send response with user data
        res.status(201).json({
            message: 'Registration successful',
            user: newUser[0]
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

        // Set session
        req.session.userId = user.id;
        req.session.username = user.username;

        res.json({
            message: 'Login successful'
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Error during login' });
    }
});

// Get profile endpoint
app.get('/get-profile', requireAuth, async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT firstName, lastName, username FROM users WHERE id = ?',
            [req.session.userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json(users[0]);
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ message: 'Error getting profile' });
    }
});

// Update profile endpoint
app.post('/update-profile', requireAuth, async (req, res) => {
    try {
        const { firstName, lastName, username } = req.body;

        // Check if username is already taken by another user
        const [existingUsers] = await pool.query(
            'SELECT id FROM users WHERE username = ? AND id != ?',
            [username, req.session.userId]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({ message: 'Username is already taken' });
        }

        // Update user profile
        await pool.query(
            'UPDATE users SET firstName = ?, lastName = ?, username = ? WHERE id = ?',
            [firstName, lastName, username, req.session.userId]
        );

        // Update session
        req.session.username = username;

        res.json({
            message: 'Profile updated successfully'
        });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ message: 'Error updating profile' });
    }
});

// Logout endpoint
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ message: 'Error logging out' });
        }
        res.json({ message: 'Logged out successfully' });
    });
});

// Forgot password endpoint
app.post('/forgot-password', async (req, res) => {
    try {
        const { username, newPassword } = req.body;

        // Check if user exists
        const [users] = await pool.query(
            'SELECT id FROM users WHERE username = ?',
            [username]
        );

        if (users.length === 0) {
            return res.status(400).json({ message: 'Username not found' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        await pool.query(
            'UPDATE users SET password = ? WHERE username = ?',
            [hashedPassword, username]
        );

        res.json({ message: 'Password reset successful' });

    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json({ message: 'Error resetting password' });
    }
});

// Get all users endpoint (except current user)
app.get('/get-users', requireAuth, async (req, res) => {
    try {
        const [users] = await pool.query(`
            SELECT id, firstName, lastName, username 
            FROM users 
            WHERE id != ? 
            ORDER BY firstName, lastName
        `, [req.session.userId]);

        // Add current user ID to response for client-side comparison
        res.json({
            users,
            currentUserId: req.session.userId
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ message: 'Error getting users' });
    }
});

// Get messages for a chat
app.get('/get-messages/:chatId', requireAuth, async (req, res) => {
    try {
        // First check if user is a participant in this chat
        const [participants] = await pool.query(
            'SELECT userId FROM chat_participants WHERE chatId = ? AND userId = ?',
            [req.params.chatId, req.session.userId]
        );

        if (participants.length === 0) {
            return res.status(403).json({ message: 'Access denied to this chat' });
        }

        const [messages] = await pool.query(`
            SELECT m.*, u.username as senderUsername
            FROM messages m
            JOIN users u ON m.senderId = u.id
            WHERE m.chatId = ?
            ORDER BY m.createdAt ASC
        `, [req.params.chatId]);

        res.json(messages);
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ message: 'Error getting messages' });
    }
});

// Send message endpoint
app.post('/send-message', requireAuth, async (req, res) => {
    try {
        const { chatId, content } = req.body;

        // Check if user is a participant in this chat
        const [participants] = await pool.query(
            'SELECT userId FROM chat_participants WHERE chatId = ? AND userId = ?',
            [chatId, req.session.userId]
        );

        if (participants.length === 0) {
            return res.status(403).json({ message: 'Access denied to this chat' });
        }

        // Insert message
        const [result] = await pool.query(
            'INSERT INTO messages (chatId, senderId, content) VALUES (?, ?, ?)',
            [chatId, req.session.userId, content]
        );

        res.json({ 
            message: 'Message sent successfully',
            messageId: result.insertId
        });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ message: 'Error sending message' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // Debug: List all registered routes
    console.log('\nRegistered Routes:');
    app._router.stack.forEach(function(r){
        if (r.route && r.route.path){
            console.log(`${Object.keys(r.route.methods).join(', ').toUpperCase()} ${r.route.path}`);
        }
    });
}); 