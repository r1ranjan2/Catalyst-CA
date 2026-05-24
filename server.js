// SABSE UPAR YE LINE ADD KI HAI - Yahi asli fix hai
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); 

require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const mongoURI = process.env.MONGO_URI; 

mongoose.connect(mongoURI)
    .then(() => console.log("🟢 Cloud Database connected successfully!"))
    .catch((err) => console.log("🔴 DB Connection Error:", err.message));

// Transporter settings
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // Port 587 ke liye false hona chahiye
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000
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

const billSchema = new mongoose.Schema({
    clientCompanyName: String,
    customerName: String,
    customerGST: String,
    invoiceNo: String,
    itemName: String,
    grandTotal: String,
    dateSaved: { type: Date, default: Date.now }
});
const Bill = mongoose.model('Bill', billSchema);

function generateAndSendPDF(billData) {
    const doc = new PDFDocument({ margin: 50 });
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', async () => {
        const pdfBuffer = Buffer.concat(buffers);
        const mailOptions = {
            from: '"Catalyst CA" <' + process.env.EMAIL_USER + '>',
            to: process.env.EMAIL_USER, 
            subject: `📄 Invoice: ${billData.invoiceNo}`,
            html: `<p>New Invoice from ${billData.clientCompanyName}</p>`,
            attachments: [{ filename: 'Invoice.pdf', content: pdfBuffer }]
        };
        try {
            await transporter.sendMail(mailOptions);
        } catch (error) {
            console.log("🔴 PDF Email Error:", error.message);
        }
    });
    doc.text(`Invoice No: ${billData.invoiceNo}`);
    doc.end();
}

app.post('/api/register', async (req, res) => {
    try {
        const { companyName, gstin, address, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "Email already registered!" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const token = "TOKEN-" + Math.random().toString(36).substring(2, 15);

        const newUser = new User({ companyName, gstin, address, email, password: hashedPassword, verificationToken: token });
        await newUser.save();

        const verificationLink = `https://catalyst-ca.onrender.com/api/verify-email?token=${token}`;
        
        // Yahan se error aa raha tha, ab ye direct IPv4 route lega
        await transporter.sendMail({
            from: '"Catalyst CA" <' + process.env.EMAIL_USER + '>', 
            to: email, 
            subject: 'Activate Account',
            html: `<a href="${verificationLink}">Verify Email</a>`
        });

        res.status(200).json({ message: "Registration successful!" });
    } catch (error) {
        console.error("🔴 Registration Error:", error);
        res.status(500).json({ message: "Server error during registration!" });
    }
});

app.get('/api/verify-email', async (req, res) => {
    try {
        const user = await User.findOne({ verificationToken: req.query.token });
        if (!user) return res.status(400).send("Invalid link");
        user.isVerified = true;
        user.verificationToken = undefined;
        await user.save();
        res.send("<h2>Account Activated!</h2>");
    } catch (error) {
        res.status(500).send("Server Error");
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        if (!user || !user.isVerified) return res.status(400).json({ message: "Account not found or not verified!" });
        const isMatch = await bcrypt.compare(req.body.password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid credentials!" });
        res.status(200).json({ companyName: user.companyName });
    } catch (error) {
        res.status(500).json({ message: "Server error!" });
    }
});

app.post('/api/save-bill', async (req, res) => {
    try {
        const savedBill = new Bill(req.body);
        await savedBill.save();
        res.status(200).json({ message: "Success!" });
        generateAndSendPDF(req.body);
    } catch (error) {
        res.status(500).json({ message: "Failed!" });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));