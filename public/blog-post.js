// Global state
// currentUser is now defined in auth-utils.js
let currentPost = null;
let postId = null;

// Get post ID from URL
function getPostId() {
    const pathParts = window.location.pathname.split('/');
    const uuid = pathParts[pathParts.length - 1];
    // Add blog: prefix for API calls
    return `blog:${uuid}`;
}

// Custom functions for blog post page
function updateBlogPostAuth(user) {
    // Update comment form if user is logged in
    updateCommentForm();
    updateAdminActions();
}

// Override the shared auth functions to include blog-post-specific logic
const originalShowLoggedInState = showLoggedInState;
const originalShowLoggedOutState = showLoggedOutState;

showLoggedInState = async function(user) {
    await originalShowLoggedInState(user);
    updateBlogPostAuth(user);
};

showLoggedOutState = function() {
    originalShowLoggedOutState();
    updateBlogPostAuth(null);
};

async function loadPost() {
    try {
        document.getElementById('loading-post').style.display = 'block';
        document.getElementById('post-content').style.display = 'none';

        const response = await fetch(`/api/content/${postId}`);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Post not found');
            }
            throw new Error('Failed to load post');
        }

        currentPost = await response.json();

        // Update page title
        document.getElementById('post-title').textContent = `${currentPost.title} | Sanctum`;
        document.title = `${currentPost.title} | Sanctum`;

        // Display post content
        document.getElementById('content-title').textContent = currentPost.title;
        document.getElementById('content-meta').innerHTML = `
            By ${escapeHtml(currentPost.author_name || 'Unknown')} •
            ${new Date(currentPost.created_at).toLocaleDateString()}
        `;

        // Add featured badge to title if featured
        const titleElement = document.getElementById('content-title');
        if (currentPost.featured) {
            titleElement.innerHTML = `${escapeHtml(currentPost.title)}<span class="featured-badge">★</span>`;
        } else {
            titleElement.textContent = currentPost.title;
        }
        document.getElementById('content-body').textContent = currentPost.body;

        // Update voting
        updateVotingButtons();

        // Update comment count
        document.getElementById('comment-count').textContent = currentPost.comment_count || 0;

        // Load comments
        await loadComments();

        // Update admin actions
        updateAdminActions();

        document.getElementById('loading-post').style.display = 'none';
        document.getElementById('post-content').style.display = 'block';

    } catch (error) {
        console.error('Error loading post:', error);
        document.getElementById('loading-post').innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
    }
}

function updateVotingButtons() {
    if (!currentPost) return;

    const userVote = getUserVote(postId);

    document.getElementById('upvote-count').textContent = currentPost.votes.up || 0;
    document.getElementById('downvote-count').textContent = currentPost.votes.down || 0;
    document.getElementById('vote-score').textContent = currentPost.votes.score || 0;

    const upBtn = document.getElementById('upvote-btn');
    const downBtn = document.getElementById('downvote-btn');

    upBtn.className = `vote-btn ${userVote === 'up' ? 'upvoted' : ''}`;
    downBtn.className = `vote-btn ${userVote === 'down' ? 'downvoted' : ''}`;

    upBtn.disabled = !currentUser;
    downBtn.disabled = !currentUser;
}

function updateCommentForm() {
    const formContent = document.getElementById('comment-form-content');
    if (currentUser) {
        formContent.innerHTML = `
            <textarea id="comment-text" placeholder="Add a comment..." rows="3"></textarea>
            <button onclick="submitComment()" class="btn-comment">Comment</button>
        `;
    } else {
        formContent.innerHTML = `
            <div class="login-prompt">
                <div class="login-prompt-content">
                    <p>You must be logged in to leave a comment.</p>
                    <button class="auth-button" onclick="goToLogin()">Login</button>
                </div>
            </div>
        `;
    }
}

function updateAdminActions() {
    const adminActions = document.getElementById('admin-actions');
    if (!currentPost || !currentUser) {
        adminActions.innerHTML = '';
        return;
    }

    const isAuthor = currentUser.id === currentPost.author_id;
    const isModerator = currentUser.roles.includes('admin') || currentUser.roles.includes('moderator');
    const canEdit = isAuthor || isModerator;

    let actionsHtml = '';

    if (canEdit) {
        actionsHtml += `
            <button class="admin-btn admin-btn-nav admin-btn-edit" onclick="editPost()" title="Edit post">
                Edit
            </button>
        `;

        // Add enable/disable post button
        if (currentPost.enabled !== false) {
            actionsHtml += `
                <button class="admin-btn admin-btn-action admin-btn-disable" onclick="togglePostEnabled(false)" title="Disable post">
                    DISABLE
                </button>
            `;
        } else {
            actionsHtml += `
                <button class="admin-btn admin-btn-action" onclick="togglePostEnabled(true)" title="Enable post">
                    ENABLE
                </button>
            `;
        }
    }

    if (isModerator) {
        if (currentPost.featured) {
            actionsHtml += `
                <button class="admin-btn admin-btn-action admin-btn-demote" onclick="demoteFromFrontPage()" title="Remove from front page">
                    DEMOTE
                </button>
            `;
        } else {
            actionsHtml += `
                <button class="admin-btn admin-btn-action" onclick="promoteToFrontPage()" title="Promote to front page">
                    PROMOTE
                </button>
            `;
        }
    }

    // Create structure with both desktop buttons and mobile hamburger menu
    if (actionsHtml) {
        adminActions.innerHTML = `
            <div class="desktop-admin-actions">
                ${actionsHtml}
            </div>
            <div class="admin-hamburger-menu" onclick="toggleMobileAdminActions(event)">
                <div class="hamburger-line"></div>
                <div class="hamburger-line"></div>
                <div class="hamburger-line"></div>
            </div>
            <div class="mobile-admin-actions" id="mobile-admin-actions">
                ${actionsHtml}
            </div>
        `;
    } else {
        adminActions.innerHTML = '';
    }
}

function getUserVote(contentId) {
    const votes = JSON.parse(localStorage.getItem('userVotes') || '{}');
    return votes[contentId] || null;
}

async function vote(direction) {
    if (!currentUser) return;

    try {
        const response = await fetch(`/api/content/${postId}/vote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ vote: direction })
        });

        if (response.ok) {
            const result = await response.json();

            // Update local vote tracking
            const votes = JSON.parse(localStorage.getItem('userVotes') || '{}');
            votes[postId] = result.userVote;
            localStorage.setItem('userVotes', JSON.stringify(votes));

            // Update post data and buttons
            currentPost.votes = result.votes;
            updateVotingButtons();
        } else {
            console.error('Failed to vote');
        }
    } catch (error) {
        console.error('Error voting:', error);
    }
}

function toggleComments() {
    const commentsSection = document.getElementById('comments-section');
    const contentActions = document.getElementById('content-actions');

    // Since comments are now visible by default, we need to check the computed style or use a different approach
    const isVisible = commentsSection.style.display !== 'none';
    if (isVisible) {
        commentsSection.style.display = 'none';
        // Remove the comments-expanded class to round bottom corners of content-actions
        contentActions.classList.remove('comments-expanded');
    } else {
        commentsSection.style.display = 'block';
        // Add the comments-expanded class to make content-actions corners straight
        contentActions.classList.add('comments-expanded');
    }
}

async function loadComments() {
    try {
        const response = await fetch(`/api/content/${postId}/comments`);
        if (!response.ok) {
            throw new Error('Failed to load comments');
        }

        const comments = await response.json();
        const commentsList = document.getElementById('comments-list');

        if (comments.length === 0) {
            commentsList.innerHTML = '<p class="no-comments-blog"></p>';
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
        document.getElementById('comments-list').innerHTML =
            '<p class="error">Failed to load comments.</p>';
    }
}

async function submitComment() {
    const textarea = document.getElementById('comment-text');
    const content = textarea.value.trim();

    if (!content) return;

    try {
        const requestBody = {
            content: content,
            author_name: currentUser.name
        };

        // Only add email if it's a valid email format
        if (currentUser.email && typeof currentUser.email === 'string' && currentUser.email.trim() && /\S+@\S+\.\S+/.test(currentUser.email)) {
            requestBody.author_email = currentUser.email;
        }

        console.log('Submitting comment with body:', requestBody);

        const response = await fetch(`/api/content/${postId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (response.ok) {
            textarea.value = '';
            await loadComments();
            await loadPost(); // Refresh to update comment count
        } else {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            console.error('Comment submission failed:', response.status, errorData);
            throw new Error(errorData.error || `Failed to submit comment (${response.status})`);
        }
    } catch (error) {
        console.error('Error submitting comment:', error);
        alert('Failed to submit comment. Please try again.');
    }
}

async function promoteToFrontPage() {
    try {
        const response = await fetch(`/api/content/${postId}/promote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            alert('Post promoted to front page successfully!');
            await loadPost(); // Refresh to update featured status
        } else {
            const error = await response.json();
            alert(`Failed to promote post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error promoting post:', error);
        alert('Failed to promote post. Please try again.');
    }
}

async function demoteFromFrontPage() {
    try {
        const response = await fetch(`/api/content/${postId}/demote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            alert('Post removed from front page successfully!');
            await loadPost(); // Refresh to update featured status
        } else {
            const error = await response.json();
            alert(`Failed to demote post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error demoting post:', error);
        alert('Failed to demote post. Please try again.');
    }
}

function editPost() {
    // Strip the blog: prefix for the URL
    const uuid = postId.replace('blog:', '');
    window.location.href = `/blogs/edit/${uuid}`;
}

async function togglePostEnabled(enable) {
    try {
        const response = await fetch(`/api/content/${postId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: currentPost.type,
                title: currentPost.title,
                body: currentPost.body,
                tags: currentPost.tags || [],
                status: currentPost.status || 'published',
                promoted: currentPost.promoted || false,
                enabled: enable
            })
        });

        if (response.ok) {
            alert(`Post ${enable ? 'enabled' : 'disabled'} successfully!`);
            await loadPost(); // Refresh to update post status
        } else {
            const error = await response.json();
            alert(`Failed to ${enable ? 'enable' : 'disable'} post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error toggling post:', error);
        alert('Failed to update post setting. Please try again.');
    }
}

async function updatePost(newBody) {
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
            await loadPost(); // Refresh the post
        } else {
            const error = await response.json();
            alert(`Failed to update post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error updating post:', error);
        alert('Failed to update post. Please try again.');
    }
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

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    postId = getPostId();

    if (!postId) {
        document.getElementById('loading-post').innerHTML = '<p style="color: red;">Invalid post URL</p>';
        return;
    }

    await checkAuth();
    await loadPost();
});