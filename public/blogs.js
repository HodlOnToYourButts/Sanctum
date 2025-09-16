// Global state
let currentSort = 'new';
let currentUser = null;

async function checkAuth() {
    try {
        const response = await fetch('/user');
        if (response.ok) {
            const user = await response.json();
            showLoggedInState(user);
        } else if (response.status === 401) {
            // Expected when not logged in - don't log as error
            showLoggedOutState();
        } else {
            console.warn('Auth check returned unexpected status:', response.status);
            showLoggedOutState();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        showLoggedOutState();
    }
}

function showLoggedInState(user) {
    currentUser = user;
    document.getElementById('user-name-header').textContent = user.name || 'User';
    document.getElementById('user-info').classList.add('show');

    let authButtons = '<button class="auth-button logout" onclick="logout()">Logout</button>';

    if (user.roles && user.roles.includes('admin')) {
        authButtons = '<a href="/admin" class="auth-button">Admin</a>' + authButtons;
    }

    document.getElementById('auth-section').innerHTML = authButtons;

    // Show create blog button when logged in
    document.getElementById('create-blog-btn').style.display = 'block';
}

function showLoggedOutState() {
    document.getElementById('user-info').classList.remove('show');
    document.getElementById('auth-section').innerHTML =
        '<a href="/login" class="auth-button">Login / Sign Up</a>';

    // Hide create blog button when logged out
    document.getElementById('create-blog-btn').style.display = 'none';
}

async function logout() {
    try {
        const response = await fetch('/logout', {
            method: 'POST',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                showLoggedOutState();
                // Optionally redirect to OIDC logout URL for complete logout
                if (result.logoutUrl) {
                    window.location.href = result.logoutUrl;
                }
            } else {
                console.error('Logout failed:', result.error);
            }
        } else {
            console.error('Logout failed');
        }
    } catch (error) {
        console.error('Logout error:', error);
    }
}

async function loadContentFeed() {
    try {
        const response = await fetch(`/api/content/feed?type=blog&sort=${currentSort}`);
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
        container.innerHTML = '<p class="loading" style="text-align: center;">No blogs found.</p>';
        return;
    }

    container.innerHTML = contentList.map(item => {
        const userVote = getUserVote(item._id);
        const isAuthor = currentUser && currentUser.id === item.author_id;
        const isModerator = currentUser && (currentUser.roles.includes('admin') || currentUser.roles.includes('moderator'));
        const canEdit = isAuthor || isModerator;

        return `
            <div class="content-item">
                <div class="content-header-item">
                    <div>
                        <div class="content-title clickable-title" onclick="viewFullPost('${item._id}')">${escapeHtml(item.title)}</div>
                        <div class="content-meta">
                            By ${escapeHtml(item.author_name || 'Unknown')} •
                            ${new Date(item.created_at).toLocaleDateString()} •
                            ${item.type}
                            ${item.featured ? '<span class="featured-badge">Featured</span>' : ''}
                        </div>
                    </div>
                    <div class="content-admin-actions">
                        ${isModerator ? (item.featured ? `
                            <button class="admin-btn demote-btn" onclick="demoteFromFrontPage('${item._id}')" title="Remove from front page">
                                [DEMOTE]
                            </button>
                        ` : `
                            <button class="admin-btn promote-btn" onclick="promoteToFrontPage('${item._id}')" title="Promote to front page">
                                [PROMOTE]
                            </button>
                        `) : ''}
                        ${canEdit ? `
                            <button class="admin-btn edit-btn" onclick="editPost('${item._id}')" title="Edit post">
                                [EDIT]
                            </button>
                        ` : ''}
                    </div>
                </div>
                <div class="content-body clickable-content" onclick="viewFullPost('${item._id}')">${escapeHtml(item.body.length > 300 ? item.body.substring(0, 300) + '...' : item.body)}</div>
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
                    <div class="comment-actions">
                        ${item.allow_comments ? `
                            <button class="comment-btn" onclick="toggleComments('${item._id}')">
                                [MSG] ${item.comment_count || 0} comments
                            </button>
                        ` : ''}
                    </div>
                </div>
                ${item.allow_comments ? `
                    <div id="comments-${item._id}" class="comments-section" style="display: none;">
                        <div class="comment-form">
                            ${currentUser ? `
                                <textarea id="comment-text-${item._id}" placeholder="Add a comment..." rows="3"></textarea>
                                <button onclick="submitComment('${item._id}')" class="btn-comment">Comment</button>
                            ` : '<p>Login to leave a comment</p>'}
                        </div>
                        <div id="comments-list-${item._id}" class="comments-list">
                            Loading comments...
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

// Track user votes locally for undo functionality
let userVotes = {};

async function vote(contentId, voteType) {
    if (!currentUser) {
        alert('Please login to vote');
        return;
    }

    try {
        const currentVote = userVotes[contentId];
        const actualVote = (currentVote === voteType) ? 'remove' : voteType;

        const response = await fetch(`/api/content/${contentId}/vote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ vote: actualVote })
        });

        if (!response.ok) {
            throw new Error('Failed to vote');
        }

        const result = await response.json();

        if (actualVote === 'remove') {
            delete userVotes[contentId];
        } else {
            userVotes[contentId] = actualVote;
        }

        loadContentFeed();
    } catch (error) {
        console.error('Voting error:', error);
        alert('Failed to vote. Please try again.');
    }
}

function getUserVote(contentId) {
    return userVotes[contentId] || null;
}

function setSort(sort) {
    currentSort = sort;

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

function getRelativeTime(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)}mo ago`;
    return `${Math.floor(diffInSeconds / 31536000)}y ago`;
}

async function toggleComments(contentId) {
    const commentsSection = document.getElementById(`comments-${contentId}`);
    if (commentsSection.style.display === 'none') {
        commentsSection.style.display = 'block';
        await loadComments(contentId);
    } else {
        commentsSection.style.display = 'none';
    }
}

async function loadComments(contentId) {
    try {
        const response = await fetch(`/api/content/${contentId}/comments`);
        if (!response.ok) {
            throw new Error('Failed to load comments');
        }

        const comments = await response.json();
        const commentsList = document.getElementById(`comments-list-${contentId}`);

        if (comments.length === 0) {
            commentsList.innerHTML = '<p class="no-comments">No comments yet. Be the first to comment!</p>';
            return;
        }

        commentsList.innerHTML = comments.map(comment => {
            const commentDate = new Date(comment.created_at);
            return `
                <div class="comment">
                    <div class="comment-header">
                        <strong>${escapeHtml(comment.author_name)}</strong>
                        <span class="comment-date" title="${commentDate.toLocaleString()}">${getRelativeTime(commentDate)}</span>
                    </div>
                    <div class="comment-content">${escapeHtml(comment.content)}</div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading comments:', error);
        document.getElementById(`comments-list-${contentId}`).innerHTML =
            '<p class="error">Failed to load comments.</p>';
    }
}

async function submitComment(contentId) {
    if (!currentUser) {
        alert('Please login to comment');
        return;
    }

    const textarea = document.getElementById(`comment-text-${contentId}`);
    const content = textarea.value.trim();

    if (!content) {
        alert('Please enter a comment');
        return;
    }

    try {
        const response = await fetch(`/api/content/${contentId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: content,
                author_name: currentUser.name,
                author_email: currentUser.email
            })
        });

        if (!response.ok) {
            throw new Error('Failed to submit comment');
        }

        textarea.value = '';
        await loadComments(contentId);
        loadContentFeed();
    } catch (error) {
        console.error('Error submitting comment:', error);
        alert('Failed to submit comment. Please try again.');
    }
}

// View full post
function viewFullPost(postId) {
    window.location.href = `/blogs/${postId}`;
}

// Promote post to front page
async function promoteToFrontPage(postId) {
    try {
        const response = await fetch(`/api/content/${postId}/promote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            alert('Post promoted to front page successfully!');
            loadContentFeed(); // Refresh the feed
        } else {
            const error = await response.json();
            alert(`Failed to promote post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error promoting post:', error);
        alert('Failed to promote post. Please try again.');
    }
}

// Demote post from front page
async function demoteFromFrontPage(postId) {
    try {
        const response = await fetch(`/api/content/${postId}/demote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            alert('Post removed from front page successfully!');
            loadContentFeed(); // Refresh the feed
        } else {
            const error = await response.json();
            alert(`Failed to demote post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error demoting post:', error);
        alert('Failed to demote post. Please try again.');
    }
}

// Edit post
function editPost(postId) {
    window.location.href = `/blogs/edit/${postId}`;
}

// Update post content
async function updatePost(postId, newBody) {
    try {
        const response = await fetch(`/api/content/${postId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                body: newBody
            })
        });

        if (response.ok) {
            alert('Post updated successfully!');
            loadContentFeed(); // Refresh the feed
        } else {
            const error = await response.json();
            alert(`Failed to update post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error updating post:', error);
        alert('Failed to update post. Please try again.');
    }
}

// Create new blog
function createNewBlog() {
    window.location.href = '/blogs/create';
}

// Check authentication status on page load
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadContentFeed();

    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setSort(btn.dataset.sort);
        });
    });
});