const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  const token = req.header('Authorization');
  if (!token) return res.status(401).send('Access Denied');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findById(decoded.id); 

    if (!user) return res.status(401).send('User not found');
    req.user = user; 
    next();
  } catch (err) {
    res.status(400).send('Invalid Token');
  }
};

module.exports = authMiddleware;

