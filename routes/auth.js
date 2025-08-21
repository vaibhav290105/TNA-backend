const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); 
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

router.patch('/update-image', auth, upload.single('image'), async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ msg: 'User not found' });

  if (req.file) {
    if (user.image) {
      const imagePath = path.join(__dirname, '..', 'uploads', user.image);
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }
    user.image = req.file.filename;
    await user.save();
  }

  res.json({ msg: 'Image updated', image: user.image });
});




router.post('/register', upload.single('image'), async (req, res) => {
  const { name, email, password, role, department, location } = req.body;
  const image = req.file ? req.file.filename : null;

  const existing = await User.findOne({ email });
  if (existing) return res.status(400).json({ msg: 'User already exists' });

  const hashed = await bcrypt.hash(password, 10);

  const user = new User({
    name,
    email,
    password: hashed,
    role,
    department,
    location,
    image
  });

  await user.save();
  res.status(201).json({ msg: 'User created' });
});



router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ msg: 'Invalid credentials' });

  const token = jwt.sign({ id: user._id, role: user.role, name: user.name, department: user.department, location:user.location }, process.env.JWT_SECRET);
  res.json({ token, role: user.role, name: user.name, department: user.department, location: user.location});
});

router.get('/users', auth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);

    if (!currentUser) return res.status(401).json({ msg: 'User not found' });

    let filter = {};

    if (currentUser.role === 'admin') {
      
      filter = {};
    } else if (currentUser.role === 'hod') {
     
      filter = {
        department: currentUser.department,
        role: { $in: ['employee', 'manager'] },
        _id: { $ne: currentUser._id }, 
      };
    } else {
      return res.status(403).json({ msg: 'Forbidden' });
    }

    const users = await User.find(filter)
  .select('name email role department manager')
  .populate('manager', 'name email department');
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});


router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('manager', 'name email'); 

    let mappedEmployees = [];

    if (user.role === 'manager') {
      mappedEmployees = await User.find({ manager: user._id }, 'name department email');
    }

    res.json({ ...user.toObject(), mappedEmployees, imageUrl: user.image ? `http://localhost:5000/uploads/${user.image}` : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});




router.patch('/users/:id/assign-manager', auth, async (req, res) => {
  if (!['admin', 'hod'].includes(req.user.role)) return res.status(403).send('Forbidden');
  const { managerId } = req.body;

  try {
    const employee = await User.findById(req.params.id);
    
    if (employee.manager) {
      return res.status(400).send('Employee already assigned to a manager');
    }

    employee.manager = managerId;
    await employee.save();

    res.json({ msg: 'Manager assigned successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error assigning manager');
  }
});




// Unmap employee from manager
router.patch('/users/:id/unassign-manager', auth, async (req, res) => {
  if (!['admin', 'hod'].includes(req.user.role)) {
    return res.status(403).send('Forbidden');
  }

  try {
    const employee = await User.findById(req.params.id);
    if (!employee) return res.status(404).send('Employee not found');

    employee.manager = null; // remove manager assignment
    await employee.save();

    res.json({ msg: 'Manager unassigned successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error unassigning manager');
  }
});





// POST /auth/request-reset
router.post('/request-reset', async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ msg: 'User not found' });

  const token = crypto.randomBytes(32).toString('hex');
  user.resetToken = token;
  user.resetTokenExpiry = Date.now() + 3600000; // 1 hour
  await user.save();

  const resetLink = `https://tna-frontend-bmht.onrender.com/reset-password/${token}`;

  // Set up nodemailer
  const transporter = nodemailer.createTransport({
    service: 'Gmail', 
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    to: email,
    subject: 'Password Reset Link',
    html: `<p>Click <a href="${resetLink}">here</a> to reset your password. This link will expire in 1 hour.</p>`,
  });

  res.json({ msg: 'Reset link sent to email' });
});



router.post('/reset-password/:token', async (req, res) => {
  const { password } = req.body;
  const { token } = req.params;

  const user = await User.findOne({
    resetToken: token,
    resetTokenExpiry: { $gt: Date.now() },
  });

  if (!user) return res.status(400).json({ msg: 'Invalid or expired token' });

  user.password = await bcrypt.hash(password, 10);
  user.resetToken = null;
  user.resetTokenExpiry = null;
  await user.save();

  res.json({ msg: 'Password reset successfully' });
});



// Get employees assigned to a particular manager (used by HOD/Admin)
router.get('/users/manager/:managerId', auth, async (req, res) => {
  try {
    const managerId = req.params.managerId;

    if (!['admin', 'hod'].includes(req.user.role)) {
      return res.status(403).json({ msg: 'Forbidden' });
    }

    const employees = await User.find({ manager: managerId })
      .select('name email department location');

    res.json(employees);
  } catch (err) {
    console.error('Error fetching mapped employees:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// PATCH /auth/update-profile
router.patch('/update-profile', auth, async (req, res) => {
  const { name, department, location, email } = req.body;
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ msg: 'User not found' });

  user.name = name || user.name;
  user.department = department || user.department;
  user.location = location || user.location;
  user.email = email || user.email;

  await user.save();
  res.json({ msg: 'Profile updated', user });
});







module.exports = router;
