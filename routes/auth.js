const express = require('express');
const passport = require('passport');
const router = express.Router();

router.get('/login', passport.authenticate('zombieauth'));

router.get('/callback',
  passport.authenticate('zombieauth', { failureRedirect: '/login' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

router.get('/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      roles: req.user.roles
    });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

module.exports = router;