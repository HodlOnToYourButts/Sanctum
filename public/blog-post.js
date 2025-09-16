// Global state
let currentUser = null;
let currentPost = null;
let postId = null;

// Get post ID from URL
function getPostId() {
    const pathParts = window.location.pathname.split('/');
    return pathParts[pathParts.length - 1];
}

async function checkAuth() {
    try {
        const response = await fetch('/user');
        if (response.ok) {
            const user = await response.json();
            showLoggedInState(user);
        } else if (response.status === 401) {
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

    // Update comment form if user is logged in
    updateCommentForm();
    updateAdminActions();
}

function showLoggedOutState() {
    currentUser = null;
    document.getElementById('user-info').classList.remove('show');
    document.getElementById('auth-section').innerHTML =
        '<a href="/login" class="auth-button">Login / Sign Up</a>';

    updateCommentForm();
    updateAdminActions();
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
            ${new Date(currentPost.created_at).toLocaleDateString()} •
            ${currentPost.type}
            ${currentPost.featured ? '<span class="featured-badge">FEATURED</span>' : ''}
        `;
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
        formContent.innerHTML = '<p>Login to leave a comment</p>';
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

    if (isModerator && !currentPost.featured) {
        actionsHtml += `
            <button class="admin-btn admin-btn-action" onclick="promoteToFrontPage()" title="Promote to front page">
                PROMOTE
            </button>
        `;
    }

    if (canEdit) {
        actionsHtml += `
            <button class="admin-btn admin-btn-nav" onclick="editPost()" title="Edit post">
                Edit
            </button>
        `;
    }

    adminActions.innerHTML = actionsHtml;
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
    if (commentsSection.style.display === 'none') {
        commentsSection.style.display = 'block';
    } else {
        commentsSection.style.display = 'none';
    }
}

async function loadComments() {
    // Implementation would be similar to the blogs.js loadComments function
    // For now, just show placeholder
    document.getElementById('comments-list').innerHTML = '<p>Comments loading...</p>';
}

async function submitComment() {
    const textarea = document.getElementById('comment-text');
    const content = textarea.value.trim();

    if (!content) return;

    try {
        const response = await fetch(`/api/content/${postId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: content,
                author_name: currentUser.name,
                author_email: currentUser.email
            })
        });

        if (response.ok) {
            textarea.value = '';
            await loadComments();
            await loadPost(); // Refresh to update comment count
        } else {
            throw new Error('Failed to submit comment');
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

function editPost() {
    window.location.href = `/blogs/edit/${postId}`;
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