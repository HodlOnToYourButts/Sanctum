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
    currentUser = user; // Store globally for voting
    document.getElementById('user-name-header').textContent = user.name || 'User';
    document.getElementById('user-info').classList.add('show');

    let authButtons = '<button class="auth-button logout" onclick="logout()">Logout</button>';

    // Add admin link if user has admin role
    if (user.roles && user.roles.includes('admin')) {
        authButtons = '<a href="/admin" class="auth-button">Admin</a>' + authButtons;
    }

    document.getElementById('auth-section').innerHTML = authButtons;
}

function showLoggedOutState() {
    document.getElementById('user-info').classList.remove('show');
    document.getElementById('auth-section').innerHTML =
        '<button class="auth-button" onclick="goToLogin()">Login</button>';
}

function goToLogin() {
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.href = `/login?return=${returnUrl}`;
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

// Site title is now hardcoded, no dynamic loading needed

// Global state
let currentSort = 'new';
let currentUser = null;

async function loadContentFeed() {
    try {
        const response = await fetch(`/api/content/feed?type=all&sort=${currentSort}`);
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
        container.innerHTML = '<p class="loading" style="text-align: center;">No content found.</p>';
        return;
    }

    container.innerHTML = contentList.map(item => {
        const userVote = getUserVote(item._id);
        const isAuthor = currentUser && currentUser.id === item.author_id;
        const isModerator = currentUser && (currentUser.roles.includes('admin') || currentUser.roles.includes('moderator'));
        const canEdit = isAuthor || isModerator;

        return `
            <div class="content-item content-item-${item.type}">
                <div class="content-header-item">
                    <div>
                        <div class="content-title clickable-title" onclick="viewFullPost('${item._id}')">${escapeHtml(item.title)}</div>
                        <div class="content-meta">
                            <span class="content-type-badge content-type-${item.type}">${getContentTypeLabel(item.type)}</span>
                            By ${escapeHtml(item.author_name || 'Unknown')} •
                            ${new Date(item.created_at).toLocaleDateString()}
                        </div>
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
                                ${getCommentLabel(item.type, item.comment_count || 0)}
                            </button>
                        ` : ''}
                    </div>
                </div>
                ${item.allow_comments ? `
                    <div id="comments-${item._id}" class="comments-section" data-content-type="${item.type}" style="display: ${openComments.has(item._id) ? 'block' : 'none'};">
                        <div class="comment-form">
                            ${currentUser ? `
                                <textarea id="comment-text-${item._id}" placeholder="Add a ${getCommentType(item.type)}..." rows="3"></textarea>
                                <button onclick="submitComment('${item._id}')" class="btn-comment">${getCommentButtonLabel(item.type)}</button>
                            ` : `<div class=\"login-prompt\"><div class=\"login-prompt-content\"><p>You must be logged in to leave a ${getCommentType(item.type)}.</p><button class=\"auth-button\" onclick=\"goToLogin()\">Login</button></div></div>`}
                        </div>
                        <div id="comments-list-${item._id}" class="comments-list">
                            Loading ${getCommentType(item.type)}s...
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    // Restore open comment sections after rebuilding
    openComments.forEach(contentId => {
        const commentsSection = document.getElementById(`comments-${contentId}`);
        if (commentsSection) {
            const contentType = commentsSection.dataset.contentType || 'blog';
            loadComments(contentId, contentType);
        }
    });
}

// Content type configuration for extensibility
function getContentTypeLabel(type) {
    const typeLabels = {
        'blog': 'Blog',
        'forum': 'Forum',
        'event': 'Event',
        'site': 'Site',
        'game': 'Game',
        'project': 'Project',
        'tutorial': 'Tutorial',
        'announcement': 'Announcement'
    };
    return typeLabels[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

function getCommentType(type) {
    const commentTypes = {
        'blog': 'comment',
        'forum': 'reply',
        'event': 'comment',
        'site': 'review',
        'game': 'comment',
        'project': 'comment',
        'tutorial': 'comment',
        'announcement': 'comment'
    };
    return commentTypes[type] || 'comment';
}

function getCommentLabel(type, count) {
    const commentType = getCommentType(type);
    let pluralType = commentType;

    if (count !== 1) {
        // Handle irregular plurals
        if (commentType === 'reply') {
            pluralType = 'replies';
        } else {
            pluralType = commentType + 's';
        }
    }

    return `${count} ${pluralType}`;
}

function getCommentButtonLabel(type) {
    const commentType = getCommentType(type);
    return commentType.charAt(0).toUpperCase() + commentType.slice(1);
}

// Track user votes locally for undo functionality
let userVotes = {};

// Track which comment sections are open
let openComments = new Set();

async function vote(contentId, voteType) {
    if (!currentUser) {
        alert('Please login to vote');
        return;
    }

    try {
        // Check if user already voted this way - if so, remove vote
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

        // Update local vote tracking
        if (actualVote === 'remove') {
            delete userVotes[contentId];
        } else {
            userVotes[contentId] = actualVote;
        }

        // Reload content to update vote counts
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
        openComments.add(contentId);
        const contentType = commentsSection.dataset.contentType || 'blog';
        await loadComments(contentId, contentType);
    } else {
        commentsSection.style.display = 'none';
        openComments.delete(contentId);
    }
}

async function loadComments(contentId, contentType = 'blog') {
    try {
        const response = await fetch(`/api/content/${contentId}/comments`);
        if (!response.ok) {
            throw new Error('Failed to load comments');
        }

        const comments = await response.json();
        const commentsList = document.getElementById(`comments-list-${contentId}`);

        if (comments.length === 0) {
            const noCommentsClass = contentType === 'forum' ? 'no-replies-forum' : 'no-comments-blog';
            commentsList.innerHTML = `<p class="${noCommentsClass}"></p>`;
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

        // Reload content feed to update comment count
        loadContentFeed();
    } catch (error) {
        console.error('Error submitting comment:', error);
        alert('Failed to submit comment. Please try again.');
    }
}

// View full post - route based on content type
function viewFullPost(postId) {
    // For now, determine content type by checking against current loaded content
    // In a more robust implementation, this could be passed as a parameter
    const contentFeed = document.getElementById('content-feed');
    const contentItems = contentFeed.querySelectorAll('.content-item');

    for (let item of contentItems) {
        if (item.innerHTML.includes(postId)) {
            if (item.classList.contains('content-item-forum')) {
                window.location.href = `/forum/view/${postId}`;
                return;
            } else if (item.classList.contains('content-item-blog')) {
                window.location.href = `/blog/view/${postId}`;
                return;
            }
        }
    }

    // Default fallback to blog view
    window.location.href = `/blog/view/${postId}`;
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
    window.location.href = `/blog/edit/${postId}`;
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