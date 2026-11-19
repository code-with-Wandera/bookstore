require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
// DASHBOARD ANALYTICS & LOW STOCK ALERTS (Problem Statement & Objective III)
// ============================================================================
app.get('/api/dashboard', async (req, res) => {
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

        // Objective III: Flag books with fewer than 5 items remaining
        const [lowStockBooks] = await pool.query(
            `SELECT b.*, c.name AS category_name 
             FROM books b 
             LEFT JOIN categories c ON b.category_id = c.id 
             WHERE b.stock_quantity < 5 
             ORDER BY b.stock_quantity ASC`
        );

        // Best-selling titles (Addresses Problem Statement empirical restocking)
        const [topSelling] = await pool.query(
            `SELECT b.title, b.isbn, SUM(si.quantity) AS units_sold, SUM(si.subtotal) AS revenue
             FROM sale_items si
             JOIN books b ON si.book_id = b.id
             GROUP BY b.id
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

// ============================================================================
// CATEGORIES MANAGEMENT (Objective I)
// ============================================================================
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories ORDER BY name ASC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categories', async (req, res) => {
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

// ============================================================================
// INVENTORY CRUD & SEARCH (Objectives I, III, IV)
// ============================================================================
// Get all books OR search by Title, Author, or ISBN (Objective IV)
app.get('/api/books', async (req, res) => {
    const search = req.query.search ? req.query.search.trim() : '';
    try {
        let query = `
            SELECT b.*, c.name AS category_name 
            FROM books b 
            LEFT JOIN categories c ON b.category_id = c.id
        `;
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

// Add new book (Objective I)
app.post('/api/books', async (req, res) => {
    const { isbn, title, author, category_id, price, stock_quantity } = req.body;
    if (!isbn || !title || !author || price === undefined || stock_quantity === undefined) {
        return res.status(400).json({ error: 'All book fields are required' });
    }
    try {
        const [result] = await pool.query(
            `INSERT INTO books (isbn, title, author, category_id, price, stock_quantity) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [isbn.trim(), title.trim(), author.trim(), category_id || null, price, stock_quantity]
        );
        res.status(201).json({ id: result.insertId, message: 'Book added successfully' });
    } catch (err) {
        res.status(400).json({ error: err.code === 'ER_DUP_ENTRY' ? 'ISBN already exists' : err.message });
    }
});

// Edit book record, price, category, or stock (Objective I)
app.put('/api/books/:id', async (req, res) => {
    const { isbn, title, author, category_id, price, stock_quantity } = req.body;
    try {
        await pool.query(
            `UPDATE books 
             SET isbn = ?, title = ?, author = ?, category_id = ?, price = ?, stock_quantity = ? 
             WHERE id = ?`,
            [isbn.trim(), title.trim(), author.trim(), category_id || null, price, stock_quantity, req.params.id]
        );
        res.json({ message: 'Book updated successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Delete book record (Objective I)
app.delete('/api/books/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM books WHERE id = ?', [req.params.id]);
        res.json({ message: 'Book deleted successfully' });
    } catch (err) {
        res.status(400).json({ error: 'Cannot delete book linked to existing sales records' });
    }
});

// ============================================================================
// AUTOMATED SALES PROCESSING WITH ACID TRANSACTIONS (Objective II)
// ============================================================================
app.post('/api/sales', async (req, res) => {
    const { customer_name, items } = req.body; // items: [{ book_id, quantity }]
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Cart cannot be empty' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let totalAmount = 0;
        const verifiedItems = [];

        // 1. Validate stock & lock rows for update
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

        // 2. Create Sale Header
        const receiptNumber = 'REC-' + Date.now();
        const [saleResult] = await connection.query(
            'INSERT INTO sales (receipt_number, customer_name, total_amount) VALUES (?, ?, ?)',
            [receiptNumber, customer_name || 'Walk-in Customer', totalAmount]
        );
        const saleId = saleResult.insertId;

        // 3. Log Sale Items & Deduct Stock in Real-Time
        for (const vItem of verifiedItems) {
            await connection.query(
                `INSERT INTO sale_items (sale_id, book_id, quantity, unit_price, subtotal) 
                 VALUES (?, ?, ?, ?, ?)`,
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

// Get Historical Sales Log (Problem Statement & Objective II)
app.get('/api/sales', async (req, res) => {
    try {
        const [sales] = await pool.query(
            `SELECT s.*, 
                    GROUP_CONCAT(CONCAT(b.title, ' (x', si.quantity, ')') SEPARATOR ', ') AS items_summary
             FROM sales s
             LEFT JOIN sale_items si ON s.id = si.sale_id
             LEFT JOIN books b ON si.book_id = b.id
             GROUP BY s.id
             ORDER BY s.sale_date DESC`
        );
        res.json(sales);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bookstore IMS running at http://localhost:${PORT}`));