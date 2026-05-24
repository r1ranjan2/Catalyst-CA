const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ----------------------------------------------------
// 1. MONGODB DIRECT CONNECTION
// ----------------------------------------------------
const mongoURI = "mongodb://rakesh213a:r%40506550@ac-ahsgj0i-shard-00-00.ph4mfsm.mongodb.net:27017,ac-ahsgj0i-shard-00-01.ph4mfsm.mongodb.net:27017,ac-ahsgj0i-shard-00-02.ph4mfsm.mongodb.net:27017/CatalystCADB?ssl=true&replicaSet=atlas-4aqyxn-shard-0&authSource=admin&appName=Cluster0"; 

mongoose.connect(mongoURI)
    .then(() => console.log("🟢 Cloud Database connected successfully!"))
    .catch((err) => console.log("🔴 DB Connection Error:", err.message));

// ----------------------------------------------------
// 2. EMAIL TRANSPORTER SETUP
// ----------------------------------------------------
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'contactcatalystca@gmail.com', 
        pass: 'ljwxjzeqymmlxtqa' 
    }
});

// ----------------------------------------------------
// 3. DATABASE SCHEMAS (Address added)
// ----------------------------------------------------
const userSchema = new mongoose.Schema({
    companyName: { type: String, required: true },
    gstin: String,
    address: { type: String, required: true }, // Naya Address Field
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

// ----------------------------------------------------
// 4. API ROUTES
// ----------------------------------------------------
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

        const verificationLink = `http://localhost:3000/api/verify-email?token=${token}`;
        
        const mailOptions = {
            from: '"Catalyst CA" <contactcatalystca@gmail.com>', 
            to: email, 
            subject: 'Activate your Catalyst CA Portal Account',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
                    <h2 style="color: #1d4ed8;">Welcome to Catalyst CA!</h2>
                    <p style="color: #475569; font-size: 16px;">Hello <strong>${companyName}</strong>,</p>
                    <p style="color: #475569; font-size: 16px;">Thank you for choosing Catalyst CA. Your secure GST billing portal is almost ready.</p>
                    <p style="color: #475569; font-size: 16px;">Please click the button below to verify your email and activate your account:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${verificationLink}" style="background-color: #1d4ed8; color: white; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 5px; font-size: 16px;">Activate My Account</a>
                    </div>
                    <p style="color: #94a3b8; font-size: 12px; margin-top: 30px;">If you didn't request this, please ignore this email.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ Real Email successfully sent to: ${email}`);

        res.status(200).json({ message: "Registration successful! Please check your email inbox to activate your account." });
    } catch (error) {
        console.log("🔴 REGISTRATION/EMAIL FAIL HUA:", error.message);
        res.status(500).json({ message: "Server error during registration. Check terminal." });
    }
});

app.get('/api/verify-email', async (req, res) => {
    try {
        const { token } = req.query;
        const user = await User.findOne({ verificationToken: token });

        if (!user) return res.status(400).send("<h3>Invalid or expired activation link!</h3>");

        user.isVerified = true;
        user.verificationToken = undefined;
        await user.save();

        res.send(`
            <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h2 style="color: #16a34a;">Account Successfully Activated!</h2>
                <p>You can now close this tab and login to your Catalyst CA dashboard.</p>
            </div>
        `);
    } catch (error) {
        res.status(500).send("Server Error during activation.");
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(400).json({ message: "User account not found!" });
        if (!user.isVerified) return res.status(400).json({ message: "Please activate your account via the email link first!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid password credentials!" });

        res.status(200).json({
            message: "Login successful!",
            companyName: user.companyName,
            gstin: user.gstin,
            address: user.address // Login ke time address wapas bheja
        });
    } catch (error) {
        res.status(500).json({ message: "Server login error." });
    }
});

app.post('/api/save-bill', async (req, res) => {
    try {
        const savedBill = new Bill(req.body);
        await savedBill.save();
        console.log(`✅ Invoice saved to MongoDB cloud database for: ${req.body.clientCompanyName}`);
        res.status(200).json({ message: "Success! Your GST Bill has been logged securely into the cloud database." });
    } catch (error) {
        res.status(500).json({ message: "Failed to store invoice." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Catalyst CA Final Production Backend running at Port: ${PORT}`);
});