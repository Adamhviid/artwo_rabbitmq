const express = require('express');
const { connect } = require('amqplib');
const { json } = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const azureStorage = require('azure-storage');
const dotenv = require('dotenv');
dotenv.config();

const upload = multer();
const app = express();
const corsOptions = {
    origin: ['https://artwo.onrender.com', 'http://localhost:5173'],
    optionsSuccessStatus: 200
}
app.use(cors(corsOptions));
const PORT = process.env.PORT || 3000;
console.log(`PORT: ${PORT}`);
const rabbitMQServerURL = `${process.env.RABBITMQ_SERVER_URL}`;

const storageAccount = process.env.AZURE_STORAGE_ACCOUNT;
const accessKey = process.env.AZURE_STORAGE_ACCESSKEY
const containerName = process.env.AZURE_STORAGE_CONTAINERNAME
const blobService = azureStorage.createBlobService(storageAccount, accessKey);

app.use(json());

app.post('/send-post', upload.single('image'), async (req, res) => {
    try {
        const { title, userId, content = null, tags = null } = req.body;
        const tagsArray = tags ? JSON.parse(tags) : [];

        if (!title) {
            return res.status(400).json({ success: false, error: 'Title is required' });
        }

        if (!userId) {
            return res.status(400).json({ success: false, error: 'User ID is required' });
        }

        let tempImageUrl = null;
        if (req.file) {
            const blobName = uuidv4();
            const stream = new Buffer.from(req.file.buffer);

            tempImageUrl = await new Promise((resolve, reject) => {
                blobService.createBlockBlobFromText(containerName, blobName, stream, stream.length, (error, result, response) => {
                    if (error) {
                        console.error(error);
                        reject('Error uploading image to Azure Blob Storage');
                    }

                    resolve(blobService.getUrl(containerName, blobName));
                });
            });
        }

        const post = {
            title,
            content,
            userId,
            tags: tagsArray,
            tempImageUrl
        }

        const connection = await connect(rabbitMQServerURL);
        const channel = await connection.createChannel();

        const queue = 'posts';
        await channel.assertQueue(queue, { durable: false });

        channel.sendToQueue(queue, Buffer.from(JSON.stringify(post)));
        console.log(`Message sent to 'posts'`);

        await channel.close();
        await connection.close();

        res.status(200).json({ success: true, message: 'Message sent to RabbitMQ' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/posts-queue', async (req, res) => {
    try {
        const connection = await connect(rabbitMQServerURL);
        const channel = await connection.createChannel();

        const queue = 'posts';
        await channel.assertQueue(queue, { durable: false });

        const messages = [];

        while (true) {
            const message = await channel.get(queue);

            if (!message) {
                break;
            }

            const messageData = JSON.parse(message.content.toString());
            messages.push(messageData);
        }

        await channel.close();
        await connection.close();

        res.status(200).json({ success: true, messages });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/delete-post', async (req, res) => {
    try {
        const { id } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, error: 'Post ID is required' });
        }

        const connection = await connect(rabbitMQServerURL);
        const channel = await connection.createChannel();

        const queue = 'posts-deletion';
        await channel.assertQueue(queue, { durable: false });

        const message = { id };
        channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)));

        await channel.close();
        await connection.close();

        res.status(200).json({ success: true, message: 'Deletion sent to RabbitMQ' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});