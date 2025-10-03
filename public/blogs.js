// Global state
let currentSort = 'new';
// currentUser is now defined in auth-utils.js

// Custom showLoggedInState for blogs page with create button logic
function showBlogsLoggedInState(user) {
    // Show create blog buttons when logged in
    const createButtons = document.querySelectorAll('[id^="create-blog-btn"]');
    createButtons.forEach(btn => {
        if (btn) btn.style.display = 'block';
    });
}

// Custom showLoggedOutState for blogs page with create button logic
function showBlogsLoggedOutState() {
    // Hide create blog buttons when logged out
    const createButtons = document.querySelectorAll('[id^="create-blog-btn"]');
    createButtons.forEach(btn => {
        if (btn) btn.style.display = 'none';
    });
}

// Override the shared auth functions to include blogs-specific logic
const originalShowLoggedInState = showLoggedInState;
const originalShowLoggedOutState = showLoggedOutState;

showLoggedInState = async function(user) {
    await originalShowLoggedInState(user);
    showBlogsLoggedInState(user);
};

showLoggedOutState = function() {
    originalShowLoggedOutState();
    showBlogsLoggedOutState();
};

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
        container.innerHTML = `
            <div class="content-item page-blogs">
                <div class="blogs-content-container">
                    <div class="sort-options">
                        <div class="terminal-subtitle">Blogs</div>
                        <div>
                            <button id="create-blog-btn-no-content" class="btn-create" onclick="createNewBlog()" style="display: none;">
                                Create
                            </button>
                            <button class="sort-btn ${currentSort === 'new' ? 'active' : ''}" data-sort="new" onclick="setSort('new')">New</button>
                            <button class="sort-btn ${currentSort === 'top' ? 'active' : ''}" data-sort="top" onclick="setSort('top')">Top</button>
                        </div>
                    </div>
                    <div class="no-content-message" data-nosnippet>
                        // NO BLOGS FOUND
                    </div>
                </div>
            </div>
        `;

        // Show create buttons if user is logged in
        if (currentUser) {
            setTimeout(() => {
                const createButtons = document.querySelectorAll('[id^="create-blog-btn"]');
                createButtons.forEach(btn => {
                    if (btn) btn.style.display = 'block';
                });
            }, 0);
        }
        return;
    }

    // Create a single terminal window containing all content
    let terminalContent = `
        <div class="content-item page-blogs">
            <div class="blogs-content-container">
                <div class="sort-options">
                    <div class="terminal-subtitle">Blogs</div>
                    <div>
                        <button id="create-blog-btn-content" class="btn-create" onclick="createNewBlog()" style="display: none;">
                            Create
                        </button>
                        <button class="sort-btn ${currentSort === 'new' ? 'active' : ''}" data-sort="new" onclick="setSort('new')">New</button>
                        <button class="sort-btn ${currentSort === 'top' ? 'active' : ''}" data-sort="top" onclick="setSort('top')">Top</button>
                    </div>
                </div>
    `;

    // Add all content items inside the single terminal
    terminalContent += contentList.map((item, index) => {
        const userVote = getUserVote(item._id);
        const isAuthor = currentUser && currentUser.id === item.author_id;
        const isModerator = currentUser && (currentUser.roles.includes('admin') || currentUser.roles.includes('moderator'));
        const canEdit = isAuthor || isModerator;

        return `
            <div class="content-entry content-entry-blog">
                <div class="content-header-item">
                    <div class="blog-title-section">
                        <span class="vote-score-left">${item.votes.score}</span>
                        <div>
                            <a href="/blogs/view/${item._id.replace('blog:', '')}" class="content-title clickable-title">${escapeHtml(item.title)}${item.featured ? '<span class="featured-badge">★</span>' : ''}</a>
                            <div class="content-meta">
                                By ${escapeHtml(item.author_name || 'Unknown')} •
                                ${new Date(item.created_at).toLocaleDateString()}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="content-body clickable-content" onclick="viewFullPost('${item._id}')">${escapeHtml(item.body.length > 300 ? item.body.substring(0, 300) + '...' : item.body)}</div>
            </div>
        `;
    }).join('');

    terminalContent += '</div></div>';
    container.innerHTML = terminalContent;

    // Show create buttons if user is logged in
    if (currentUser) {
        const createButtons = document.querySelectorAll('[id^="create-blog-btn"]');
        createButtons.forEach(btn => {
            if (btn) btn.style.display = 'block';
        });
    }
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

    // Update sort button active state
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.sort === sort) {
            btn.classList.add('active');
        }
    });

    // Reload content with new sort
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
            commentsList.innerHTML = '<p class="no-comments-blog" data-nosnippet></p>';
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
    window.location.href = `/blogs/view/${postId}`;
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

// URL routing function
function initializeView() {
    const path = window.location.pathname;
    const pathParts = path.split('/').filter(part => part);

    if (pathParts.length === 1 && pathParts[0] === 'blogs') {
        currentSort = 'new';
    } else if (pathParts.length === 2 && pathParts[0] === 'blogs' && pathParts[1] === 'top') {
        currentSort = 'top';
    } else {
        currentSort = 'new';
    }

    // Update sort button active state
    updateSortButtons();
}

function updateSortButtons() {
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.sort === currentSort) {
            btn.classList.add('active');
        }
    });
}

// Check authentication status on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeView();
    checkAuth();
    loadContentFeed();

    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setSort(btn.dataset.sort);
        });
    });
});