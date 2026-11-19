let allBooks = [];
let categories = [];
let cart = [];

// Navigation Tab Switching
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
        document.getElementById('page-title').textContent = btn.textContent;
        refreshAllData();
    });
});

// Initialize Application
async function refreshAllData() {
    await Promise.all([loadDashboard(), loadCategories(), loadBooks(), loadSalesHistory()]);
}

// 1. Load Dashboard & Low Stock Alerts (Objective III)
async function loadDashboard() {
    const res = await fetch('/api/dashboard');
    const data = await res.json();

    document.getElementById('kpi-today-rev').textContent = `$${Number(data.metrics.todayRevenue).toFixed(2)}`;
    document.getElementById('kpi-today-count').textContent = `${data.metrics.todaySalesCount} transactions today`;
    document.getElementById('kpi-total-rev').textContent = `$${Number(data.metrics.totalRevenue).toFixed(2)}`;
    document.getElementById('kpi-total-books').textContent = data.metrics.totalBooks;
    document.getElementById('kpi-total-stock').textContent = `${data.metrics.totalStock} total copies in store`;
    document.getElementById('kpi-low-stock').textContent = data.lowStockBooks.length;
    document.getElementById('alert-badge').textContent = `${data.lowStockBooks.length} Low Stock Alerts`;

    // Populate Low Stock Table (< 5 remaining)
    const lowStockBody = document.getElementById('low-stock-table');
    lowStockBody.innerHTML = data.lowStockBooks.length
        ? data.lowStockBooks.map(b => `
            <tr class="low-stock-row">
                <td>${b.isbn}</td>
                <td><strong>${b.title}</strong></td>
                <td>${b.author}</td>
                <td><span class="badge badge-danger">${b.stock_quantity} left</span></td>
                <td><button class="btn btn-primary btn-sm" onclick="editBook(${b.id})">Restock</button></td>
            </tr>`).join('')
        : '<tr><td colspan="5">All stock levels are healthy (5 or more items).</td></tr>';

    // Populate Best-Selling Titles Table
    const topBody = document.getElementById('top-selling-table');
    topBody.innerHTML = data.topSelling.length
        ? data.topSelling.map(t => `
            <tr>
                <td>${t.title}</td>
                <td><strong>${t.units_sold}</strong></td>
                <td>$${Number(t.revenue).toFixed(2)}</td>
            </tr>`).join('')
        : '<tr><td colspan="3">No sales recorded yet.</td></tr>';
}

// 2. Load Categories (Objective I)
async function loadCategories() {
    const res = await fetch('/api/categories');
    categories = await res.json();
    const select = document.getElementById('book-category');
    select.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

// 3. Load & Search Books (Objectives I, III, IV)
async function loadBooks(searchQuery = '') {
    const url = searchQuery ? `/api/books?search=${encodeURIComponent(searchQuery)}` : '/api/books';
    const res = await fetch(url);
    allBooks = await res.json();
    renderInventoryTable(allBooks);
    renderPOSBooks(allBooks);
}

function renderInventoryTable(books) {
    const tbody = document.getElementById('inventory-table');
    tbody.innerHTML = books.map(b => {
        const isLow = b.stock_quantity < 5;
        return `
        <tr class="${isLow ? 'low-stock-row' : ''}">
            <td>${b.isbn}</td>
            <td><strong>${b.title}</strong></td>
            <td>${b.author}</td>
            <td>${b.category_name || 'Uncategorized'}</td>
            <td>$${Number(b.price).toFixed(2)}</td>
            <td><strong>${b.stock_quantity}</strong></td>
            <td>${isLow ? '<span class="badge badge-danger">LOW STOCK</span>' : '<span class="badge badge-success">In Stock</span>'}</td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="editBook(${b.id})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteBook(${b.id})">Delete</button>
            </td>
        </tr>`;
    }).join('');
}

// Real-time Search Listener (Objective IV: Title, Author, or ISBN)
document.getElementById('search-input').addEventListener('input', (e) => {
    loadBooks(e.target.value);
});

// Add / Edit Book Modal Handlers (Objective I)
function openBookModal() {
    document.getElementById('book-form').reset();
    document.getElementById('book-id').value = '';
    document.getElementById('modal-title').textContent = 'Add New Book';
    document.getElementById('book-modal').classList.add('open');
}

function editBook(id) {
    const book = allBooks.find(b => b.id === id);
    if (!book) return;
    document.getElementById('book-id').value = book.id;
    document.getElementById('book-isbn').value = book.isbn;
    document.getElementById('book-title').value = book.title;
    document.getElementById('book-author').value = book.author;
    document.getElementById('book-category').value = book.category_id;
    document.getElementById('book-price').value = book.price;
    document.getElementById('book-stock').value = book.stock_quantity;
    document.getElementById('modal-title').textContent = 'Edit / Restock Book';
    document.getElementById('book-modal').classList.add('open');
}

document.getElementById('book-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('book-id').value;
    const payload = {
        isbn: document.getElementById('book-isbn').value,
        title: document.getElementById('book-title').value,
        author: document.getElementById('book-author').value,
        category_id: document.getElementById('book-category').value,
        price: parseFloat(document.getElementById('book-price').value),
        stock_quantity: parseInt(document.getElementById('book-stock').value, 10)
    };

    const res = await fetch(id ? `/api/books/${id}` : '/api/books', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) return alert(data.error);

    closeModals();
    refreshAllData();
});

async function deleteBook(id) {
    if (!confirm('Delete this book record from inventory?')) return;
    const res = await fetch(`/api/books/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    refreshAllData();
}

// Category Modal Handlers (Objective I)
function openCategoryModal() {
    document.getElementById('category-form').reset();
    document.getElementById('category-modal').classList.add('open');
}

document.getElementById('category-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.getElementById('cat-name').value,
            description: document.getElementById('cat-desc').value
        })
    });
    if (!res.ok) return alert('Error adding category');
    closeModals();
    loadCategories();
});

function closeModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
}

// 4. Automated Point of Sale (Objective II)
function renderPOSBooks(books) {
    const tbody = document.getElementById('pos-books-table');
    tbody.innerHTML = books.map(b => `
        <tr>
            <td><strong>${b.title}</strong><br><small>${b.isbn}</small></td>
            <td>$${Number(b.price).toFixed(2)}</td>
            <td>${b.stock_quantity}</td>
            <td>
                <button class="btn btn-primary btn-sm" 
                        ${b.stock_quantity === 0 ? 'disabled' : ''} 
                        onclick="addToCart(${b.id})">
                    ${b.stock_quantity === 0 ? 'Out' : '+ Add'}
                </button>
            </td>
        </tr>
    `).join('');
}

document.getElementById('pos-search').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allBooks.filter(b =>
        b.title.toLowerCase().includes(term) ||
        b.isbn.toLowerCase().includes(term) ||
        b.author.toLowerCase().includes(term)
    );
    renderPOSBooks(filtered);
});

function addToCart(bookId) {
    const book = allBooks.find(b => b.id === bookId);
    const existing = cart.find(c => c.book_id === bookId);

    if (existing) {
        if (existing.quantity + 1 > book.stock_quantity) {
            return alert(`Cannot exceed available stock (${book.stock_quantity})`);
        }
        existing.quantity++;
    } else {
        cart.push({ book_id: book.id, title: book.title, price: Number(book.price), quantity: 1 });
    }
    renderCart();
}

function removeFromCart(bookId) {
    cart = cart.filter(c => c.book_id !== bookId);
    renderCart();
}

function renderCart() {
    const tbody = document.getElementById('cart-table');
    let total = 0;
    tbody.innerHTML = cart.map(item => {
        const sub = item.price * item.quantity;
        total += sub;
        return `
        <tr>
            <td>${item.title}</td>
            <td>${item.quantity}</td>
            <td>$${sub.toFixed(2)}</td>
            <td><button class="btn btn-danger btn-sm" onclick="removeFromCart(${item.book_id})">X</button></td>
        </tr>`;
    }).join('');
    document.getElementById('cart-total').textContent = `$${total.toFixed(2)}`;
}

async function processSale() {
    if (cart.length === 0) return alert('Add at least one book to the cart.');

    const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            customer_name: document.getElementById('customer-name').value,
            items: cart.map(c => ({ book_id: c.book_id, quantity: c.quantity }))
        })
    });

    const data = await res.json();
    if (!res.ok) return alert(data.error);

    // Show Receipt & Reset Cart
    showReceipt(data.receipt);
    cart = [];
    document.getElementById('customer-name').value = '';
    renderCart();
    refreshAllData();
}

function showReceipt(receipt) {
    const box = document.getElementById('receipt-content');
    box.innerHTML = `
        <h3>OFFICIAL SALES RECEIPT</h3>
        <p>Receipt #: ${receipt.receiptNumber}</p>
        <p>Customer: ${receipt.customer_name}</p>
        <p>Date: ${new Date(receipt.date).toLocaleString()}</p>
        <hr style="margin: 10px 0;">
        ${receipt.items.map(i => `<p>${i.title} x${i.quantity} — $${i.subtotal.toFixed(2)}</p>`).join('')}
        <hr style="margin: 10px 0;">
        <h4>TOTAL PAID: $${receipt.totalAmount.toFixed(2)}</h4>
        <button class="btn btn-primary btn-block" onclick="closeModals()">Done</button>
    `;
    document.getElementById('receipt-modal').classList.add('open');
}

// 5. Load Sales Ledger
async function loadSalesHistory() {
    const res = await fetch('/api/sales');
    const sales = await res.json();
    document.getElementById('sales-history-table').innerHTML = sales.map(s => `
        <tr>
            <td><strong>${s.receipt_number}</strong></td>
            <td>${new Date(s.sale_date).toLocaleString()}</td>
            <td>${s.customer_name}</td>
            <td>${s.items_summary}</td>
            <td><strong>$${Number(s.total_amount).toFixed(2)}</strong></td>
        </tr>
    `).join('');
}

// Boot
refreshAllData();