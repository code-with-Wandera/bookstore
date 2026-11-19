

CREATE DATABASE IF NOT EXISTS bookstore_db;
USE bookstore_db;

-- 1. Categories Table (Supports Objective I)
CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(255)
);

-- 2. Books / Inventory Table (Supports Objectives I, III, IV)
CREATE TABLE IF NOT EXISTS books (
    id INT AUTO_INCREMENT PRIMARY KEY,
    isbn VARCHAR(20) NOT NULL UNIQUE,
    title VARCHAR(200) NOT NULL,
    author VARCHAR(150) NOT NULL,
    category_id INT,
    price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
    stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- 3. Sales Header Table (Supports Objective II & Problem Statement Financial Analytics)
CREATE TABLE IF NOT EXISTS sales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    receipt_number VARCHAR(30) NOT NULL UNIQUE,
    customer_name VARCHAR(100) DEFAULT 'Walk-in Customer',
    total_amount DECIMAL(10, 2) NOT NULL,
    sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Sale Items Table (Supports Objective II & Best-Selling Title Analytics)
CREATE TABLE IF NOT EXISTS sale_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    book_id INT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10, 2) NOT NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE RESTRICT
);

-- Seed Initial Categories
INSERT IGNORE INTO categories (name, description) VALUES
('Computer Science', 'Programming, Networking, and IT textbooks'),
('Business & Economics', 'Management, Finance, and Accounting'),
('Fiction & Literature', 'Novels, short stories, and classics'),
('Academic & Reference', 'Dictionaries, encyclopedias, and exam guides');

-- Seed Sample Books (Includes items < 5 stock to demonstrate Objective III Low Stock Alerts immediately)
INSERT IGNORE INTO books (isbn, title, author, category_id, price, stock_quantity) VALUES
('978-0134685991', 'Effective Java', 'Joshua Bloch', 1, 45.00, 12),
('978-1292296562', 'Management Information Systems', 'Kenneth C. Laudon', 2, 65.50, 3),
('978-0140449136', 'Crime and Punishment', 'Fyodor Dostoevsky', 3, 18.00, 2),
('978-0596517748', 'JavaScript: The Good Parts', 'Douglas Crockford', 1, 29.99, 8),
('978-0262033848', 'Introduction to Algorithms', 'Thomas H. Cormen', 1, 85.00, 4);
