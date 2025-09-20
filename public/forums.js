// Global state
// currentUser is now defined in auth-utils.js
let currentCategory = null;
let currentSort = 'new';

// Category slug mapping
const categoryMappings = {
    'general-discussion': { name: 'General Discussion', slug: 'general-discussion' },
    'announcements': { name: 'Announcements', slug: 'announcements' },
    'support': { name: 'Support', slug: 'support' },
    'feedback': { name: 'Feedback', slug: 'feedback' }
};

const slugToCategory = {
    'general-discussion': 'general-discussion',
    'announcements': 'announcements',
    'support': 'support',
    'feedback': 'feedback'
};

// Custom showLoggedInState for forums page with create post button logic
function showForumsLoggedInState(user) {
    // Show create post buttons when logged in and in forum view
    if (currentCategory) {
        const createButtons = document.querySelectorAll('[id^="create-post-btn"]');
        createButtons.forEach(btn => {
            if (btn) btn.style.display = 'block';
        });
    }
}

// Override the shared auth functions to include forums-specific logic
const originalShowLoggedInState = showLoggedInState;
const originalShowLoggedOutState = showLoggedOutState;

showLoggedInState = function(user) {
    originalShowLoggedInState(user);
    showForumsLoggedInState(user);
};

showLoggedOutState = function() {
    originalShowLoggedOutState();
    // No specific forums logout logic needed
};

async function loadCategories() {
    try {
        // For now, display static categories. Later this can be made dynamic
        const categories = [
            {
                id: 'general-discussion',
                title: 'General Discussion',
                description: 'General topics and discussions about anything and everything.',
                icon: '💬',
                posts: 0,
                lastActivity: null
            },
            {
                id: 'announcements',
                title: 'Announcements',
                description: 'Important updates and announcements from the team.',
                icon: '📢',
                posts: 0,
                lastActivity: null
            },
            {
                id: 'support',
                title: 'Support',
                description: 'Get help with technical issues and questions.',
                icon: '🛠️',
                posts: 0,
                lastActivity: null
            },
            {
                id: 'feedback',
                title: 'Feedback',
                description: 'Share your thoughts and suggestions for improvements.',
                icon: '💡',
                posts: 0,
                lastActivity: null
            }
        ];

        // Get post counts for each category
        for (let category of categories) {
            try {
                const response = await fetch(`/api/content/feed?type=forum&category=${category.id}`);
                if (response.ok) {
                    const posts = await response.json();
                    category.posts = posts.length;
                    if (posts.length > 0) {
                        category.lastActivity = new Date(Math.max(...posts.map(p => new Date(p.created_at))));
                    }
                }
            } catch (error) {
                console.error(`Error loading posts for category ${category.id}:`, error);
            }
        }

        displayCategories(categories);
        document.getElementById('categories-loading').style.display = 'none';
    } catch (error) {
        console.error('Error loading categories:', error);
        document.getElementById('categories-loading').innerHTML =
            `<div class="error">Failed to load categories: ${error.message}</div>`;
    }
}

function displayCategories(categories) {
    const container = document.getElementById('categories-grid');

    if (categories.length === 0) {
        container.innerHTML = `
            <div class="content-item page-forums">
                <div class="forums-content-container">
                    <div class="sort-options forums-categories-header">
                        <div class="terminal-subtitle">Forums</div>
                        <div></div>
                    </div>
                    <div class="no-content-message">
                        // NO CATEGORIES FOUND
                    </div>
                </div>
            </div>
        `;
        return;
    }

    // Create a single terminal window containing all categories
    let terminalContent = `
        <div class="content-item page-forums">
            <div class="forums-content-container">
                <div class="sort-options forums-categories-header">
                    <div class="terminal-subtitle">Forums</div>
                    <div></div>
                </div>
                <div class="category-grid">
    `;

    terminalContent += categories.map(category => {
        const categorySlug = categoryMappings[category.id]?.slug || category.id;
        return `
        <a href="/forums/category/${categorySlug}" class="category-card">
            <div class="category-icon">${category.icon}</div>
            <div class="category-title"><span class="category-prefix">></span> ${escapeHtml(category.title)}</div>
            <div class="category-description">${escapeHtml(category.description)}</div>
            <div class="category-stats">
                <span>${category.posts} posts</span>
                <span>${category.lastActivity ?
                    'Last: ' + category.lastActivity.toLocaleDateString() :
                    'No activity yet'}</span>
            </div>
        </a>
        `;
    }).join('');

    terminalContent += '</div></div></div>';
    container.innerHTML = terminalContent;
}

function openCategory(categoryId) {
    // Use clean URL navigation
    const categorySlug = categoryMappings[categoryId]?.slug || categoryId;
    window.location.href = `/forums/category/${categorySlug}`;
}

function backToCategories() {
    window.location.href = '/forums';
}

async function loadForumPosts() {
    try {
        document.getElementById('forum-loading').style.display = 'block';
        document.getElementById('forum-posts').innerHTML = '';

        // Update loading subtitle to match current category
        const loadingSubtitle = document.getElementById('forum-loading-subtitle');
        if (loadingSubtitle) {
            loadingSubtitle.textContent = categoryMappings[currentCategory]?.name || 'Forums';
        }

        const response = await fetch(`/api/content/feed?type=forum&category=${currentCategory}&sort=${currentSort}`);
        if (!response.ok) {
            throw new Error('Failed to load forum posts');
        }

        const posts = await response.json();
        displayForumPosts(posts);
        document.getElementById('forum-loading').style.display = 'none';
    } catch (error) {
        console.error('Forum posts error:', error);
        document.getElementById('forum-loading').innerHTML =
            `<div class="error">Failed to load posts: ${error.message}</div>`;
    }
}

function displayForumPosts(postsList) {
    const container = document.getElementById('forum-posts');

    if (postsList.length === 0) {
        container.innerHTML = `
            <div class="content-item page-forums">
                <div class="forums-content-container">
                    <div class="sort-options">
                        <div class="terminal-subtitle">${categoryMappings[currentCategory]?.name || 'Forums'}</div>
                        <div>
                            <button id="create-post-btn-no-content" class="btn-create" onclick="createNewPost()" style="display: none;">
                                Create
                            </button>
                            <button class="sort-btn ${currentSort === 'new' ? 'active' : ''}" data-sort="new" onclick="setSort('new')">New</button>
                            <button class="sort-btn ${currentSort === 'top' ? 'active' : ''}" data-sort="top" onclick="setSort('top')">Top</button>
                        </div>
                    </div>
                    <div class="no-content-message">
                        // NO FORUMS FOUND
                    </div>
                </div>
            </div>
        `;

        // Show create buttons if user is logged in
        if (currentUser) {
            setTimeout(() => {
                const createButtons = document.querySelectorAll('[id^="create-post-btn"]');
                createButtons.forEach(btn => {
                    if (btn) btn.style.display = 'block';
                });
            }, 0);
        }
        return;
    }

    // Sort posts to ensure pinned posts are always at the top
    const sortedPosts = postsList.sort((a, b) => {
        // Pinned posts always come first
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;

        // If both are pinned or both are not pinned, maintain the original order
        // (the backend sort is preserved within each group)
        return 0;
    });

    // Add sort buttons with terminal subtitle and forum table inside terminal
    let forumHTML = `
        <div class="content-item page-forums">
            <div class="forums-content-container">
                <div class="sort-options">
                    <div class="terminal-subtitle">${categoryMappings[currentCategory]?.name || 'Forums'}</div>
                    <div>
                        <button id="create-post-btn-content" class="btn-create" onclick="createNewPost()" style="display: none;">
                            Create
                        </button>
                        <button class="sort-btn ${currentSort === 'new' ? 'active' : ''}" data-sort="new" onclick="setSort('new')">New</button>
                        <button class="sort-btn ${currentSort === 'top' ? 'active' : ''}" data-sort="top" onclick="setSort('top')">Top</button>
                    </div>
                </div>
                <div class="forum-table">
                    <div class="forum-table-header">
                        <div class="forum-col-votes"></div>
                        <div class="forum-col-topic">TOPIC</div>
                        <div class="forum-col-author">AUTHOR</div>
                        <div class="forum-col-replies">REPLIES</div>
                        <div class="forum-col-activity">LAST ACTIVITY</div>
                    </div>
    `;

    forumHTML += sortedPosts.map(item => {
        const userVote = getUserVote(item._id);
        const isAuthor = currentUser && currentUser.id === item.author_id;
        const isModerator = currentUser && (currentUser.roles.includes('admin') || currentUser.roles.includes('moderator'));
        const canEdit = isAuthor || isModerator;
        const commentCount = item.comment_count || 0;
        const lastActivity = item.updated_at || item.created_at;
        const lastActivityDate = new Date(lastActivity);

        return `
            <div class="forum-row ${item.pinned ? 'forum-row-pinned' : ''}">
                <div class="forum-col-votes">
                    <div class="forum-votes-container">
                        <span class="vote-score">${item.votes.score}</span>
                    </div>
                </div>
                <div class="forum-col-topic">
                    <div class="forum-topic-container">
                        <div class="forum-topic-title" onclick="viewFullPost('${item._id}')">
                            <span class="forum-prefix">>></span> ${escapeHtml(item.title)}
                        </div>
                        ${item.featured ? '<span class="featured-badge">★</span>' : ''}
                    </div>
                </div>
                <div class="forum-col-author">
                    <div class="forum-author">
                        ${escapeHtml(item.author_name || 'Unknown')}
                    </div>
                    <div class="forum-post-date">
                        ${new Date(item.created_at).toLocaleDateString()}
                    </div>
                </div>
                <div class="forum-col-replies">
                    <div class="forum-replies">
                        ${commentCount}
                    </div>
                </div>
                <div class="forum-col-activity">
                    <div class="forum-activity">
                        ${getRelativeTime(lastActivityDate)}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    forumHTML += '</div></div></div>';
    container.innerHTML = forumHTML;

    // Show create buttons if user is logged in
    if (currentUser) {
        setTimeout(() => {
            const createButtons = document.querySelectorAll('[id^="create-post-btn"]');
            createButtons.forEach(btn => {
                if (btn) btn.style.display = 'block';
            });
        }, 0);
    }
}

// Track user votes locally for undo functionality
let userVotes = {};

function getUserVote(contentId) {
    return userVotes[contentId] || null;
}

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

        loadForumPosts();
    } catch (error) {
        console.error('Voting error:', error);
        alert('Failed to vote. Please try again.');
    }
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
            commentsList.innerHTML = '<p class="no-replies-forum"></p>';
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
        loadForumPosts();
    } catch (error) {
        console.error('Error submitting comment:', error);
        alert('Failed to submit comment. Please try again.');
    }
}

function viewFullPost(postId) {
    window.location.href = `/forums/view/${postId}`;
}

function editPost(postId) {
    window.location.href = `/forums/edit/${postId}`;
}

function createNewPost() {
    const categorySlug = categoryMappings[currentCategory]?.slug || currentCategory;
    window.location.href = `/forums/create/${categorySlug}`;
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
            loadForumPosts(); // Refresh the feed
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
            loadForumPosts(); // Refresh the feed
        } else {
            const error = await response.json();
            alert(`Failed to demote post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error demoting post:', error);
        alert('Failed to demote post. Please try again.');
    }
}

// Pin post to top of category
async function pinPost(postId) {
    try {
        const response = await fetch(`/api/content/${postId}/pin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            alert('Post pinned to top of category successfully!');
            loadForumPosts(); // Refresh the feed
        } else {
            const error = await response.json();
            alert(`Failed to pin post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error pinning post:', error);
        alert('Failed to pin post. Please try again.');
    }
}

// Unpin post from top of category
async function unpinPost(postId) {
    try {
        const response = await fetch(`/api/content/${postId}/unpin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            alert('Post unpinned from category successfully!');
            loadForumPosts(); // Refresh the feed
        } else {
            const error = await response.json();
            alert(`Failed to unpin post: ${error.error}`);
        }
    } catch (error) {
        console.error('Error unpinning post:', error);
        alert('Failed to unpin post. Please try again.');
    }
}

function setSort(sort) {
    if (currentCategory) {
        currentSort = sort;

        // Update sort button active state
        document.querySelectorAll('.sort-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.sort === sort) {
                btn.classList.add('active');
            }
        });

        // Reload forum posts with new sort
        loadForumPosts();
    }
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// URL routing function
function initializeView() {
    const path = window.location.pathname;
    const pathParts = path.split('/').filter(part => part); // Remove empty parts

    if (pathParts.length === 1 && pathParts[0] === 'forums') {
        // /forums - show categories
        showCategoriesView();
        loadCategories();
    } else if (pathParts.length >= 3 && pathParts[0] === 'forums' && pathParts[1] === 'category') {
        // /forums/category/general-discussion (ignore any /top path for AJAX compatibility)
        const categorySlug = pathParts[2];

        currentCategory = slugToCategory[categorySlug] || categorySlug;
        currentSort = 'new'; // Always start with 'new' sort

        showForumView(categorySlug);
        loadForumPosts();
    } else {
        // Default to categories view
        showCategoriesView();
        loadCategories();
    }
}

function showCategoriesView() {
    document.getElementById('categories-view').style.display = 'block';
    document.getElementById('forum-view').style.display = 'none';
}

function showForumView(categorySlug) {
    document.getElementById('categories-view').style.display = 'none';
    document.getElementById('forum-view').style.display = 'block';

    // Set forum title
    const categoryName = categoryMappings[currentCategory]?.name || currentCategory;
    const forumSubtitle = document.getElementById('forum-loading-subtitle');
    if (forumSubtitle) {
        forumSubtitle.textContent = categoryName;
    }

    // Show create post button if logged in
    if (currentUser) {
        document.getElementById('create-post-btn').style.display = 'block';
    }

    // Update sort button active state
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.sort === currentSort) {
            btn.classList.add('active');
        }
    });
}

// Check authentication status on page load
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    initializeView();

    // Add sort button event listeners
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setSort(btn.dataset.sort);
        });
    });
});