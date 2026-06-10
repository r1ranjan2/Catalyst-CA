require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const mongoURI = process.env.MONGO_URI; 

mongoose.connect(mongoURI)
    .then(() => console.log("🟢 Cloud Database connected successfully!"))
    .catch((err) => console.log("🔴 DB Connection Error:", err.message));

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
    itemName: mongoose.Schema.Types.Mixed, 
    qty: mongoose.Schema.Types.Mixed,      
    rate: mongoose.Schema.Types.Mixed,     
    gstPercent: mongoose.Schema.Types.Mixed,
    grandTotal: String,
    dateSaved: { type: Date, default: Date.now }
}, { strict: false }); 
const Bill = mongoose.model('Bill', billSchema);

async function sendEmailViaScript(toEmail, subject, htmlContent, base64Attachment = null, attachmentName = null) {
    try {
        const payload = { toEmail, subject, htmlContent };
        if (base64Attachment && attachmentName) {
            payload.base64Attachment = base64Attachment;
            payload.attachmentName = attachmentName;
        }

        const response = await fetch(process.env.SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        console.log("🟢 Email Script Response:", result);
    } catch (error) {
        console.error("🔴 Error calling Email Script:", error);
    }
}

function generateAndSendPDF(billData) {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    let buffers = [];
    
    const parseArray = (val) => {
        if (val === undefined || val === null || val === '') return [];
        if (Array.isArray(val)) return val;
        if (typeof val === 'string') {
            if (val.includes(',')) return val.split(',').map(s => s.trim());
            return [val.trim()];
        }
        return [val];
    };

    const getNum = (val) => {
        if (!val) return 0;
        const cleaned = val.toString().replace(/[^0-9.]/g, ''); 
        return parseFloat(cleaned) || 0;
    };

    let itemNames = parseArray(billData.itemName);
    if (itemNames.length === 0) itemNames = ['N/A'];
    
    let hsns = parseArray(billData.hsn);
    let qtys = [];
    let rates = [];
    let gsts = [];

    for(let i=0; i<itemNames.length; i++) {
        let q = billData.qty?.[i] || billData[`qty${i}`] || billData[`qty${i+1}`] || billData[`qty_${i+1}`];
        let r = billData.rate?.[i] || billData[`rate${i}`] || billData[`rate${i+1}`] || billData[`rate_${i+1}`];
        let g = billData.gstPercent?.[i] || billData[`gstPercent${i}`] || billData[`gstPercent${i+1}`];

        if (q !== undefined) qtys.push(q);
        if (r !== undefined) rates.push(r);
        if (g !== undefined) gsts.push(g);
    }

    if (qtys.length === 0) qtys = parseArray(billData.qty);
    if (rates.length === 0) rates = parseArray(billData.rate);
    if (gsts.length === 0) gsts = parseArray(billData.gstPercent);

    let lineItems = [];
    let sumTaxable = 0;
    let sumTaxAmt = 0;

    for (let i = 0; i < itemNames.length; i++) {
        let name = itemNames[i] || 'N/A';
        let hsn = hsns[i] || ''; 
        let qty = getNum(qtys[i] !== undefined ? qtys[i] : qtys[0]) || 1;
        let rate = getNum(rates[i] !== undefined ? rates[i] : 0); 
        let gst = getNum(gsts[i] !== undefined ? gsts[i] : (gsts[0] || 18));

        let taxable = rate * qty;
        let taxAmt = taxable * (gst / 100);

        sumTaxable += taxable;
        sumTaxAmt += taxAmt;

        lineItems.push({ name, hsn, qty, rate, gst, taxable, taxAmt, total: taxable + taxAmt });
    }

    let frontendTotal = getNum(billData.grandTotal);
    
    if (sumTaxable === 0 && frontendTotal > 0) {
        let defaultGst = getNum(gsts[0]) || 18;
        let totalTaxable = frontendTotal / (1 + (defaultGst / 100));
        let totalTax = frontendTotal - totalTaxable;
        
        let perItemTaxable = totalTaxable / lineItems.length;
        let perItemTax = totalTax / lineItems.length;

        lineItems.forEach(item => {
            item.taxable = perItemTaxable;
            item.taxAmt = perItemTax;
            item.rate = perItemTaxable / item.qty;
            item.total = perItemTaxable + perItemTax;
        });

        sumTaxable = totalTaxable;
        sumTaxAmt = totalTax;
    }

    let finalTaxable = getNum(billData.taxableValue) || sumTaxable;
    let finalTaxAmt = getNum(billData.taxAmount) || sumTaxAmt;
    let finalTotal = frontendTotal || (finalTaxable + finalTaxAmt);

    const strTaxable = finalTaxable.toFixed(2);
    const strTaxAmt = finalTaxAmt.toFixed(2);
    const strTotal = finalTotal.toFixed(2);

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', async () => {
        const pdfBuffer = Buffer.concat(buffers);
        const base64String = pdfBuffer.toString('base64'); 

        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #1e3a8a;">New Invoice Received!</h2>
                <p>A client has submitted a new tax invoice on the portal.</p>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 16px 0;" />
                <p><strong>Client Company:</strong> ${billData.clientCompanyName || 'N/A'}</p>
                <p><strong>Invoice No:</strong> ${billData.invoiceNo || 'N/A'}</p>
                <p><strong>Grand Total:</strong> Rs. ${strTotal}</p>
            </div>
        `;

        try {
            await sendEmailViaScript("contactcatalystca@gmail.com", `📄 New Invoice Submitted: ${billData.invoiceNo}`, htmlContent, base64String, `Invoice_${billData.invoiceNo}.pdf`);
        } catch (error) {
            console.log("🔴 Failed to send PDF email:", error.message);
        }
    });

    const primaryColor = '#1d4ed8'; 
    const textColor = '#333333';
    const lightText = '#666666';

    doc.fillColor(primaryColor).fontSize(19).font('Helvetica-Bold').text('TAX INVOICE', 50, 40);
    doc.fillColor(lightText).fontSize(8).font('Helvetica').text('Original for Recipient', 50, 65);

    doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold').text(billData.clientCompanyName || 'Your Company Name', 250, 40, { align: 'right', width: 295 });
    doc.font('Helvetica').fontSize(8).fillColor(lightText);
    
    if (billData.clientGST) doc.text(`GSTIN: ${billData.clientGST}`, 250, 56, { align: 'right', width: 295 });
    if (billData.clientState) doc.text(`State: ${billData.clientState}`, 250, 68, { align: 'right', width: 295 });
    if (billData.clientAddress) doc.text(`${billData.clientAddress}`, 250, 80, { align: 'right', width: 295 });

    doc.moveTo(50, 130).lineTo(545, 130).lineWidth(1).strokeColor('#e2e8f0').stroke();

    doc.fillColor(textColor).fontSize(9).font('Helvetica-Bold').text('Billed To (Customer Details)', 50, 150);
    doc.font('Helvetica').fontSize(9).fillColor(lightText);
    doc.text(`${billData.customerName || 'N/A'}`, 50, 170);
    doc.text(`${billData.customerGST || ''}`, 50, 185);
    doc.text(`${billData.customerAddress || ''}`, 50, 200);

    doc.fillColor(textColor).fontSize(9).font('Helvetica-Bold').text('Invoice Details', 300, 150);
    doc.font('Helvetica').fontSize(8).fillColor(lightText);
    doc.text(`Invoice No.:`, 300, 170);
    doc.fillColor(textColor).font('Helvetica-Bold').text(`${billData.invoiceNo || 'N/A'}`, 300, 185);
    doc.fillColor(lightText).font('Helvetica').text(`Invoice Date:`, 440, 170);
    doc.fillColor(textColor).font('Helvetica-Bold').text(`${new Date().toLocaleDateString()}`, 440, 185);
    
    doc.fillColor(lightText).font('Helvetica').text(`Type of Supply:`, 300, 210);
    doc.fillColor(textColor).font('Helvetica-Bold').text(`${billData.supplyType || 'Inter-State (Different State - IGST)'}`, 365, 210);

    const tableTop = 260;
    doc.rect(50, tableTop, 495, 20).fill(primaryColor);

    const headerY = tableTop + 6;
    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
    doc.text('Item Description', 60, headerY);
    doc.text('HSN', 230, headerY, { width: 50, align: 'center' }); 
    doc.text('Qty', 280, headerY, { width: 40, align: 'center' });
    doc.text('Rate (Rs)', 330, headerY, { width: 60, align: 'center' });
    doc.text('GST %', 400, headerY, { width: 40, align: 'center' });
    doc.text('Amount (Rs)', 460, headerY, { width: 75, align: 'right' });

    let currentY = tableTop + 30;
    doc.fillColor(textColor).fontSize(8).font('Helvetica');
    
    lineItems.forEach((item) => {
        let startY = currentY;
        doc.text(item.name, 60, startY, { width: 160 }); 
        let textHeight = doc.y - startY; 
        
        doc.text(item.hsn, 230, startY, { width: 50, align: 'center' });
        doc.text(item.qty.toString(), 280, startY, { width: 40, align: 'center' });
        doc.text(item.rate.toFixed(2), 330, startY, { width: 60, align: 'center' });
        doc.text(`${item.gst}%`, 400, startY, { width: 40, align: 'center' });
        doc.text(item.total.toFixed(2), 460, startY, { width: 75, align: 'right' });
        
        currentY = startY + Math.max(textHeight, 15) + 8; 
    });

    doc.moveTo(50, currentY).lineTo(545, currentY).lineWidth(1).strokeColor('#e2e8f0').stroke();

    const totalBoxY = currentY + 15;
    // SMART LOGIC: Box height badha di taaki CGST/SGST dono perfectly fit ho jayein
    doc.rect(320, totalBoxY, 225, 75).lineWidth(1).strokeColor('#e2e8f0').stroke();

    const taxY = totalBoxY + 8;
    doc.fillColor(lightText).fontSize(8).text('Taxable Value:', 330, taxY);
    doc.fillColor(textColor).text(`Rs. ${strTaxable}`, 460, taxY, { width: 75, align: 'right' });

    let nextY = taxY + 16;
    const isIgst = billData.supplyType && billData.supplyType.includes('IGST');

    // SMART LOGIC: PDF Draw Break-up (IGST vs CGST/SGST)
    if (isIgst) {
        doc.fillColor(lightText).text('IGST:', 330, nextY);
        doc.fillColor(textColor).text(`Rs. ${strTaxAmt}`, 460, nextY, { width: 75, align: 'right' });
        nextY += 16;
    } else {
        const halfTax = (finalTaxAmt / 2).toFixed(2);
        doc.fillColor(lightText).text('CGST:', 330, nextY);
        doc.fillColor(textColor).text(`Rs. ${halfTax}`, 460, nextY, { width: 75, align: 'right' });
        nextY += 16;
        doc.fillColor(lightText).text('SGST:', 330, nextY);
        doc.fillColor(textColor).text(`Rs. ${halfTax}`, 460, nextY, { width: 75, align: 'right' });
        nextY += 16;
    }

    const grandY = taxY + 52;
    doc.moveTo(320, grandY - 6).lineTo(545, grandY - 6).lineWidth(1).strokeColor('#e2e8f0').stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(primaryColor).text('Grand Total:', 330, grandY);
    doc.text(`Rs. ${strTotal}`, 440, grandY, { width: 95, align: 'right' });

    const footerY = Math.max(totalBoxY + 90, currentY + 110);
    
    doc.rect(50, footerY, 495, 100).lineWidth(1).strokeColor('#e2e8f0').stroke();
    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8).text('Terms & Conditions', 60, footerY + 8);
    doc.fillColor(lightText).font('Helvetica').fontSize(8); 
    
    const defaultTerms = "1. Any disputes will be under Local jurisdiction.\n2. Goods once sold will not be taken back.\n3. Payment shall be made within 15 days from the date of invoice; otherwise interest @ 18% per annum will be charged.\n4. All warranties are as per company rules.\nE. & O. E.";
    const termsToPrint = billData.terms || defaultTerms;
    
    // FIXED: Height limit strictly badha kar 85 kar di gayi hai.
    doc.text(termsToPrint, 60, footerY + 22, { width: 475, height: 85, ellipsis: true });

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
        
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px;">
                <h2 style="color: #1d4ed8;">Welcome to Catalyst CA!</h2>
                <p>Hello <strong>${companyName}</strong>,</p>
                <p>Please click the button below to verify your email address.</p>
                <a href="${verificationLink}" style="display: inline-block; background-color: #1d4ed8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 15px;">Activate My Account</a>
            </div>
        `;
        await sendEmailViaScript(email, 'Activate your Catalyst CA Portal Account', htmlContent);
        res.status(200).json({ message: "Registration successful! Please check your email." });
    } catch (error) {
        res.status(500).json({ message: "Server error during registration!" });
    }
});

app.get('/api/verify-email', async (req, res) => {
    try {
        const { token } = req.query;
        const user = await User.findOne({ verificationToken: token });
        if (!user) return res.status(400).send("<h3>Invalid or expired link!</h3>");
        
        user.isVerified = true; user.verificationToken = undefined;
        await user.save();
        res.send(`<div style="text-align: center; margin-top: 50px;"><h2 style="color: green;">Account Activated Successfully! ✅</h2></div>`);
    } catch (error) { res.status(500).send("Server Error."); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "Account not found!" });
        if (!user.isVerified) return res.status(400).json({ message: "Please verify your email first!" });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid credentials!" });
        
        res.status(200).json({ companyName: user.companyName, gstin: user.gstin, address: user.address });
    } catch (error) { res.status(500).json({ message: "Server error!" }); }
});

app.post('/api/save-bill', async (req, res) => {
    try {
        const savedBill = new Bill(req.body);
        await savedBill.save();
        res.status(200).json({ message: "Success! Bill submitted." });
        generateAndSendPDF(req.body);
    } catch (error) { res.status(500).json({ message: "Failed to store invoice." }); }
});

app.listen(PORT, () => console.log(`🚀 Catalyst CA Backend running at Port: ${PORT}`));