require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();
app.use(cors());
app.use(express.json());

// Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 8
    }
}));

// MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================
function requireAuthPage(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    return res.redirect('/login.html');
}

function requireAuthAPI(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
}

app.get(['/', '/index.html'], requireAuthPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================
app.post('/api/auth/register', async (req, res) => {
    const { full_name, email, password, role } = req.body;
    if (!full_name || !email || !password) {
        return res.status(400).json({ error: 'Full name, email, and password are required.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const validRole = role === 'Admin' ? 'Admin' : 'Cashier';

        const [result] = await pool.query(
            'INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)',
            [full_name.trim(), email.trim().toLowerCase(), passwordHash, validRole]
        );

        req.session.user = {
            id: result.insertId,
            full_name: full_name.trim(),
            email: email.trim().toLowerCase(),
            role: validRole
        };

        res.status(201).json({ message: 'Account created successfully', user: req.session.user });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'An account with this email already exists.' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        const [[user]] = await pool.query(
            'SELECT * FROM users WHERE email = ?',
            [email.trim().toLowerCase()]
        );

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        req.session.user = {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            role: user.role
        };

        res.json({ message: 'Login successful', user: req.session.user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/auth/me', requireAuthAPI, (req, res) => {
    res.json({ user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ message: 'Logged out' });
    });
});

// ============================================================================
// PROTECTED DASHBOARD, INVENTORY & POS ROUTES
// ============================================================================
app.get('/api/dashboard', requireAuthAPI, async (req, res) => {
    try {
        const [[{ totalBooks, totalStock }]] = await pool.query(
            'SELECT COUNT(*) AS totalBooks, COALESCE(SUM(stock_quantity), 0) AS totalStock FROM books'
        );

        const [[{ todayRevenue, todaySalesCount }]] = await pool.query(
            `SELECT COALESCE(SUM(total_amount), 0) AS todayRevenue, COUNT(*) AS todaySalesCount 
             FROM sales WHERE DATE(sale_date) = CURDATE()`
        );

        const [[{ totalRevenue }]] = await pool.query(
            'SELECT COALESCE(SUM(total_amount), 0) AS totalRevenue FROM sales'
        );

        const [lowStockBooks] = await pool.query(
            `SELECT b.*, c.name AS category_name 
             FROM books b LEFT JOIN categories c ON b.category_id = c.id 
             WHERE b.stock_quantity < 5 ORDER BY b.stock_quantity ASC`
        );

        const [topSelling] = await pool.query(
            `SELECT b.title, b.isbn, COALESCE(SUM(si.quantity), 0) AS units_sold, COALESCE(SUM(si.subtotal), 0) AS revenue
             FROM sale_items si
             JOIN books b ON si.book_id = b.id
             GROUP BY b.id, b.title, b.isbn
             ORDER BY units_sold DESC
             LIMIT 5`
        );

        res.json({
            metrics: { totalBooks, totalStock, todayRevenue, todaySalesCount, totalRevenue },
            lowStockBooks,
            topSelling
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/categories', requireAuthAPI, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories ORDER BY name ASC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categories', requireAuthAPI, async (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Category name is required' });
    try {
        const [result] = await pool.query(
            'INSERT INTO categories (name, description) VALUES (?, ?)',
            [name.trim(), description || '']
        );
        res.status(201).json({ id: result.insertId, name, description });
    } catch (err) {
        res.status(400).json({ error: 'Category already exists or invalid data' });
    }
});

app.get('/api/books', requireAuthAPI, async (req, res) => {
    const search = req.query.search ? req.query.search.trim() : '';
    try {
        let query = `SELECT b.*, c.name AS category_name FROM books b LEFT JOIN categories c ON b.category_id = c.id`;
        let params = [];
        if (search) {
            query += ` WHERE b.title LIKE ? OR b.author LIKE ? OR b.isbn LIKE ?`;
            const wildcard = `%${search}%`;
            params = [wildcard, wildcard, wildcard];
        }
        query += ` ORDER BY b.id DESC`;
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/books', requireAuthAPI, async (req, res) => {
    const { isbn, title, author, category_id, price, stock_quantity } = req.body;
    if (!isbn || !title || !author || price === undefined || stock_quantity === undefined) {
        return res.status(400).json({ error: 'All book fields are required' });
    }
    try {
        const [result] = await pool.query(
            `INSERT INTO books (isbn, title, author, category_id, price, stock_quantity) VALUES (?, ?, ?, ?, ?, ?)`,
            [isbn.trim(), title.trim(), author.trim(), category_id || null, price, stock_quantity]
        );
        res.status(201).json({ id: result.insertId, message: 'Book added successfully' });
    } catch (err) {
        res.status(400).json({ error: err.code === 'ER_DUP_ENTRY' ? 'ISBN already exists' : err.message });
    }
});

app.put('/api/books/:id', requireAuthAPI, async (req, res) => {
    const { isbn, title, author, category_id, price, stock_quantity } = req.body;
    try {
        await pool.query(
            `UPDATE books SET isbn = ?, title = ?, author = ?, category_id = ?, price = ?, stock_quantity = ? WHERE id = ?`,
            [isbn.trim(), title.trim(), author.trim(), category_id || null, price, stock_quantity, req.params.id]
        );
        res.json({ message: 'Book updated successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/books/:id', requireAuthAPI, async (req, res) => {
    try {
        await pool.query('DELETE FROM books WHERE id = ?', [req.params.id]);
        res.json({ message: 'Book deleted successfully' });
    } catch (err) {
        res.status(400).json({ error: 'Cannot delete book linked to existing sales records' });
    }
});

app.post('/api/sales', requireAuthAPI, async (req, res) => {
    const { customer_name, items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Cart cannot be empty' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        let totalAmount = 0;
        const verifiedItems = [];

        for (const item of items) {
            const [[book]] = await connection.query(
                'SELECT id, title, price, stock_quantity FROM books WHERE id = ? FOR UPDATE',
                [item.book_id]
            );
            if (!book) throw new Error(`Book ID ${item.book_id} not found`);
            if (book.stock_quantity < item.quantity) {
                throw new Error(`Insufficient stock for "${book.title}". Available: ${book.stock_quantity}`);
            }
            const subtotal = Number(book.price) * Number(item.quantity);
            totalAmount += subtotal;
            verifiedItems.push({
                book_id: book.id,
                title: book.title,
                quantity: Number(item.quantity),
                unit_price: Number(book.price),
                subtotal
            });
        }

        const receiptNumber = 'REC-' + Date.now();
        const [saleResult] = await connection.query(
            'INSERT INTO sales (receipt_number, customer_name, total_amount) VALUES (?, ?, ?)',
            [receiptNumber, customer_name || 'Walk-in Customer', totalAmount]
        );
        const saleId = saleResult.insertId;

        for (const vItem of verifiedItems) {
            await connection.query(
                `INSERT INTO sale_items (sale_id, book_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)`,
                [saleId, vItem.book_id, vItem.quantity, vItem.unit_price, vItem.subtotal]
            );
            await connection.query(
                'UPDATE books SET stock_quantity = stock_quantity - ? WHERE id = ?',
                [vItem.quantity, vItem.book_id]
            );
        }

        await connection.commit();
        res.status(201).json({
            message: 'Sale completed and stock updated',
            receipt: {
                receiptNumber,
                customer_name: customer_name || 'Walk-in Customer',
                totalAmount,
                items: verifiedItems,
                date: new Date()
            }
        });
    } catch (err) {
        await connection.rollback();
        res.status(400).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.get('/api/sales', requireAuthAPI, async (req, res) => {
    try {
        const [sales] = await pool.query(
            `SELECT s.*, GROUP_CONCAT(CONCAT(b.title, ' (x', si.quantity, ')') SEPARATOR ', ') AS items_summary
             FROM sales s LEFT JOIN sale_items si ON s.id = si.sale_id LEFT JOIN books b ON si.book_id = b.id
             GROUP BY s.id ORDER BY s.sale_date DESC`
        );
        res.json(sales);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bookstore IMS running at http://localhost:${PORT}`));