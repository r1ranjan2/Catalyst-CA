require('dotenv').config(); // Sabse upar yeh line zaroori hai
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit'); // PDF banane ke liye library

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Database connection using Environment Variable from .env file
const mongoURI = process.env.MONGO_URI; 

mongoose.connect(mongoURI)
    .then(() => console.log("🟢 Cloud Database connected successfully!"))
    .catch((err) => console.log("🔴 DB Connection Error:", err.message));

// Email Transporter using Environment Variables
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

// Background function: Jo PDF banayega aur CA ko mail karega
function generateAndSendPDF(billData) {
    const doc = new PDFDocument({ margin: 50 });
    let buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', async () => {
        const pdfBuffer = Buffer.concat(buffers);

        const mailOptions = {
            from: '"Catalyst CA Portal" <contactcatalystca@gmail.com>',
            to: process.env.EMAIL_USER, // Yeh email aapko (CA) ko hi jayega
            subject: `📄 New Invoice Submitted: ${billData.invoiceNo} - ${billData.clientCompanyName}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <h2 style="color: #1e3a8a; margin-bottom: 4px;">New Invoice Received!</h2>
                    <p style="color: #64748b; font-size: 14px; margin-top: 0;">A client has submitted a new tax invoice on the portal.</p>
                    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 16px 0;" />
                    <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
                        <tr><td style="padding: 6px 0; font-weight: bold; color: #334155;">Client Company:</td><td style="color: #475569;">${billData.clientCompanyName}</td></tr>
                        <tr><td style="padding: 6px 0; font-weight: bold; color: #334155;">Invoice No:</td><td style="color: #475569;">${billData.invoiceNo}</td></tr>
                        <tr><td style="padding: 6px 0; font-weight: bold; color: #334155;">Customer Name:</td><td style="color: #475569;">${billData.customerName}</td></tr>
                        <tr><td style="padding: 6px 0; font-weight: bold; color: #334155;">Grand Total:</td><td style="color: #1e3a8a; font-weight: bold;">${billData.grandTotal}</td></tr>
                    </table>
                    <p style="margin-top: 20px; font-size: 13px; color: #64748b;">The official invoice PDF has been automatically generated and attached below.</p>
                </div>
            `,
            attachments: [
                {
                    filename: `Invoice_${billData.invoiceNo}_${billData.clientCompanyName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`,
                    content: pdfBuffer
                }
            ]
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log(`📧 PDF Email successfully sent for Invoice: ${billData.invoiceNo}`);
        } catch (error) {
            console.log("🔴 Failed to send PDF email:", error.message);
        }
    });

    // PDF Layout Design
    doc.rect(20, 20, 572, 752).stroke('#1e3a8a'); // Border
    
    doc.fillColor('#1e3a8a').fontSize(24).text('TAX INVOICE SUMMARY', { align: 'center', underline: true });
    doc.moveDown(2);

    doc.fillColor('#334155').fontSize(12);
    doc.text(`Invoice Number :   ${billData.invoiceNo}`, { name: 'Helvetica-Bold' });
    doc.text(`Date & Time    :   ${new Date().toLocaleString()}`);
    doc.moveDown();

    doc.text('-------------------------------------------------------------------------------------------------------');
    doc.moveDown();

    doc.fillColor('#1e3a8a').fontSize(14).text('PARTY DETAILS', { underline: true });
    doc.moveDown(0.5);
    doc.fillColor('#334155').fontSize(12);
    doc.text(`Billed By (Client)   :  ${billData.clientCompanyName.toUpperCase()}`);
    doc.text(`Billed To (Customer) :  ${billData.customerName}`);
    doc.text(`Customer GSTIN      :  ${billData.customerGST || 'N/A'}`);
    doc.moveDown();

    doc.text('-------------------------------------------------------------------------------------------------------');
    doc.moveDown();

    doc.fillColor('#1e3a8a').fontSize(14).text('ITEM DESCRIPTION', { underline: true });
    doc.moveDown(0.5);
    doc.fillColor('#334155').fontSize(12);
    doc.text(`Items: ${billData.itemName}`, { width: 500, align: 'left' });
    doc.moveDown(2);

    doc.text('-------------------------------------------------------------------------------------------------------');
    doc.moveDown();

    doc.fillColor('#1e3a8a').fontSize(16).text(`GRAND TOTAL (incl. GST):   ${billData.grandTotal}`, { align: 'right', bold: true });
    
    doc.moveDown(4);
    doc.fillColor('#94a3b8').fontSize(10).text('This is an automatically generated system summary report compiled for Catalyst CA.', { align: 'center', italic: true });

    doc.end();
}

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

        const verificationLink = `http://localhost:${PORT}/api/verify-email?token=${token}`;
        
        const mailOptions = {
            from: '"Catalyst CA" <contactcatalystca@gmail.com>', 
            to: email, 
            subject: 'Activate your Catalyst CA Portal Account',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px;">
                    <h2 style="color: #1d4ed8;">Welcome to Catalyst CA!</h2>
                    <p>Hello <strong>${companyName}</strong>,</p>
                    <p>Please click the button below to verify your email:</p>
                    <a href="${verificationLink}" style="background-color: #1d4ed8; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Activate My Account</a>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: "Registration successful! Please check your email." });
    } catch (error) {
        res.status(500).json({ message: "Server error!" });
    }
});

app.get('/api/verify-email', async (req, res) => {
    try {
        const { token } = req.query;
        const user = await User.findOne({ verificationToken: token });
        if (!user) return res.status(400).send("<h3>Invalid link!</h3>");
        user.isVerified = true;
        user.verificationToken = undefined;
        await user.save();
        res.send("<h2>Account Activated! You can close this tab.</h2>");
    } catch (error) {
        res.status(500).send("Server Error.");
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !user.isVerified) return res.status(400).json({ message: "Account not found or not verified!" });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid credentials!" });
        res.status(200).json({ companyName: user.companyName, gstin: user.gstin, address: user.address });
    } catch (error) {
        res.status(500).json({ message: "Server error!" });
    }
});

app.post('/api/save-bill', async (req, res) => {
    try {
        const savedBill = new Bill(req.body);
        await savedBill.save();
        
        // Frontend ko turant success bhejenge taaki user experience super fast rahe
        res.status(200).json({ message: "Success! Bill submitted." });

        // Background mein PDF banakar CA ko email send kar dega
        generateAndSendPDF(req.body);

    } catch (error) {
        res.status(500).json({ message: "Failed to store invoice." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Catalyst CA Backend running at Port: ${PORT}`);
});