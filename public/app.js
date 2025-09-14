async function checkAuth() {
    try {
        const response = await fetch('/user');
        if (response.ok) {
            const user = await response.json();
            showLoggedInState(user);
        } else {
            showLoggedOutState();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        showLoggedOutState();
    }
}

function showLoggedInState(user) {
    currentUser = user; // Store globally for voting
    document.getElementById('user-name').textContent = user.name || 'User';
    document.getElementById('user-email').textContent = user.email || '';
    document.getElementById('user-info').classList.add('show');

    let authButtons = '<button class="auth-button logout" onclick="logout()">Logout</button>';

    // Add admin link if user has admin role
    if (user.roles && user.roles.includes('admin')) {
        authButtons = '<a href="/admin" class="auth-button" style="margin-right: 0.5rem; text-decoration: none;">Admin</a>' + authButtons;
    }

    document.getElementById('auth-section').innerHTML = authButtons;
}

function showLoggedOutState() {
    document.getElementById('user-info').classList.remove('show');
    document.getElementById('auth-section').innerHTML =
        '<a href="/login" class="auth-button">Login / Sign Up</a>';
}

async function logout() {
    try {
        const response = await fetch('/logout', { method: 'POST' });
        if (response.ok) {
            showLoggedOutState();
        } else {
            console.error('Logout failed');
        }
    } catch (error) {
        console.error('Logout error:', error);
    }
}

async function loadSiteSettings() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const settings = await response.json();
            document.querySelector('.logo').textContent = settings.name || 'Sanctum';
            document.querySelector('.subtitle').textContent = settings.description || 'Distributed Content Management System';
        }
    } catch (error) {
        console.error('Failed to load site settings:', error);
    }
}

// Global state
let currentContentType = 'all';
let currentSort = 'new';
let currentUser = null;

async function loadContentFeed() {
    try {
        const response = await fetch(`/api/content/feed?type=${currentContentType}&sort=${currentSort}`);
        if (!response.ok) {
            throw new Error('Failed to load content feed');
        }

        const content = await response.json();
        displayContentFeed(content);
        document.getElementById('content-loading').style.display = 'none';
    } catch (error) {
        console.error('Content feed error:', error);
        document.getElementById('content-loading').innerHTML =
            `<div class="error">Failed to load content: ${error.message}</div>`;
    }
}

function displayContentFeed(contentList) {
    const container = document.getElementById('content-feed');

    if (contentList.length === 0) {
        container.innerHTML = '<p class="loading">No content found.</p>';
        return;
    }

    container.innerHTML = contentList.map(item => {
        const userVote = getUserVote(item._id); // TODO: Get actual user vote
        return `
            <div class="content-item">
                <div class="content-header-item">
                    <div>
                        <div class="content-title">${escapeHtml(item.title)}</div>
                        <div class="content-meta">
                            By ${escapeHtml(item.author_name || 'Unknown')} •
                            ${new Date(item.created_at).toLocaleDateString()} •
                            ${item.type}
                        </div>
                    </div>
                </div>
                <div class="content-body">${escapeHtml(item.body)}</div>
                ${item.tags && item.tags.length > 0 ? `
                    <div class="content-tags">
                        ${item.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                    </div>
                ` : ''}
                <div class="content-actions">
                    <div class="vote-buttons">
                        <button class="vote-btn ${userVote === 'up' ? 'upvoted' : ''}"
                                onclick="vote('${item._id}', 'up')" ${!currentUser ? 'disabled' : ''}>
                            ↑ ${item.votes.up}
                        </button>
                        <span class="vote-score">${item.votes.score}</span>
                        <button class="vote-btn ${userVote === 'down' ? 'downvoted' : ''}"
                                onclick="vote('${item._id}', 'down')" ${!currentUser ? 'disabled' : ''}>
                            ↓ ${item.votes.down}
                        </button>
                    </div>
                    <div>
                        ${item.allow_comments ? `<span>${item.comment_count || 0} comments</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function vote(contentId, voteType) {
    if (!currentUser) {
        alert('Please login to vote');
        return;
    }

    try {
        const response = await fetch(`/api/content/${contentId}/vote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ vote: voteType })
        });

        if (!response.ok) {
            throw new Error('Failed to vote');
        }

        const result = await response.json();
        // Reload content to update vote counts
        loadContentFeed();
    } catch (error) {
        console.error('Voting error:', error);
        alert('Failed to vote. Please try again.');
    }
}

function getUserVote(contentId) {
    // TODO: Implement user vote tracking
    return null;
}

function setContentType(type) {
    currentContentType = type;

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.type === type) {
            item.classList.add('active');
        }
    });

    // Update title
    const title = type === 'all' ? 'All Content' : type.charAt(0).toUpperCase() + type.slice(1) + 's';
    document.getElementById('content-type-title').textContent = title;

    loadContentFeed();
}

function setSort(sort) {
    currentSort = sort;

    // Update sort button active state
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.sort === sort) {
            btn.classList.add('active');
        }
    });

    loadContentFeed();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Check authentication status on page load
document.addEventListener('DOMContentLoaded', () => {
    loadSiteSettings();
    checkAuth();
    loadContentFeed();

    // Add event listeners for navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            setContentType(item.dataset.type);
        });
    });

    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setSort(btn.dataset.sort);
        });
    });
});