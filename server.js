require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const mongoURI = process.env.MONGO_URI; 

mongoose.connect(mongoURI)
    .then(() => console.log("🟢 Cloud Database connected successfully!"))
    .catch((err) => console.log("🔴 DB Connection Error:", err.message));

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    }
});

const userSchema = new mongoose.Schema({
    companyName: { type: String, required: true },
    gstin: String,
    address: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
    verificationToken: String
});
const User = mongoose.model('User', userSchema);

app.post('/api/register', async (req, res) => {
    try {
        const { companyName, gstin, address, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "Email already registered!" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const token = "TOKEN-" + Math.random().toString(36).substring(2, 15);

        const newUser = new User({
            companyName, gstin, address, email, password: hashedPassword, verificationToken: token
        });
        await newUser.save();

        const verificationLink = `https://catalyst-ca.onrender.com/api/verify-email?token=${token}`;
        
        const mailOptions = {
            from: '"Catalyst CA" <' + process.env.EMAIL_USER + '>', 
            to: email, 
            subject: 'Activate your Catalyst CA Portal Account',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px;">
                    <h2 style="color: #1d4ed8;">Welcome to Catalyst CA!</h2>
                    <p>Hello <strong>${companyName}</strong>,</p>
                    <p>Please click the button below to verify your email address. This step is required to activate your account and start generating invoices.</p>
                    <a href="${verificationLink}" style="display: inline-block; background-color: #1d4ed8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 15px;">Activate My Account</a>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: "Registration successful! Please check your email." });
    } catch (error) {
        console.log("Registration Email Error: ", error);
        res.status(500).json({ message: "Server error during registration!" });
    }
});

app.get('/api/verify-email', async (req, res) => {
    try {
        const { token } = req.query;
        const user = await User.findOne({ verificationToken: token });
        if (!user) return res.status(400).send("<h3>Invalid or expired link!</h3>");
        
        user.isVerified = true;
        user.verificationToken = undefined;
        await user.save();
        
        res.send(`
            <div style="text-align: center; font-family: Arial, sans-serif; margin-top: 50px;">
                <h2 style="color: green;">Account Activated Successfully! ✅</h2>
                <p>You can now close this tab and login to your portal.</p>
            </div>
        `);
    } catch (error) {
        res.status(500).send("Server Error.");
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "Account not found!" });
        
        if (!user.isVerified) return res.status(400).json({ message: "Please verify your email first! Check your inbox." });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid credentials!" });
        
        res.status(200).json({ companyName: user.companyName, gstin: user.gstin, address: user.address });
    } catch (error) {
        res.status(500).json({ message: "Server error!" });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Catalyst CA Backend running at Port: ${PORT}`);
});