"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function () { return m[k]; } });
} : function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
});
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
} : function (o, v) {
    o["default"] = v;
});
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bot = void 0;

const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();

const grammy_1 = require("grammy");
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const fal = require('@fal-ai/serverless-client');
const ethers_1 = require("ethers");

fal.config({
    credentials: process.env.FAL_API_KEY,
});
if (!process.env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN environment variable is not set.");
}
const bot = new grammy_1.Bot(process.env.BOT_TOKEN);
exports.bot = bot;

bot.use((0, grammy_1.session)({
    initial: () => ({
        answers: [],
        contact: null,
        imageUrl: null
    }),
}));

bot.command("start", async (ctx) => {
    ctx.session.answers = [];
    ctx.session.contact = null;
    ctx.session.imageUrl = null;
    await ctx.reply("Welcome Aspiring Detectives. To pass your first test you must describe one of the leaders who resides in our hall of fame. What kind of hero/heroine were they (film noir, ninja, cowboy, classic hollywood detective, alien, knight, etc ? ");
});

bot.on("message:text", async (ctx) => {
    const session = ctx.session;
    if (session.answers.length < 3) {
        session.answers.push(ctx.msg.text);
        switch (session.answers.length) {
            case 1:
                await ctx.reply("Did they have always look at the camera or was it at a specific side or angle?");
                break;
            case 2:
                await ctx.reply("What about their eyes, did they wear sunglasses, or have special eye colors?")
                break;
            case 3:
                const prompt = `An editorial photograph of a glossy black and white, 1920's inspire image of a ${session.answers[0]}, the face has ${session.answers[1]}, and is positioned at ${session.answers[2]}, sleek, 3D, symmetrical, 4k, award-winning, crisp, detailed`;
                await ctx.reply("Creating your agent ...");


                try {
                    const imageUrl = await generateImage(prompt);
                    session.imageUrl = imageUrl;
                    await ctx.reply(`Here is your image: ${imageUrl}`);
                    await ctx.reply("Please provide your email or a social media handle to submit this image.");
                } catch (error) {
                    await ctx.reply("Failed to generate image.");
                }
                break;
        }
    } else {
        // After user provides contact info
        session.contact = ctx.msg.text;
        await uploadToPinata(session.imageUrl, session.contact);
    }
});

async function generateImage(prompt) {
    const options = {
        input: {
            prompt,
            num_inference_steps: 35,
            guidance_scale: 8,
            image_size: "landscape_16_9"
        },
        headers: { Authorization: `Bearer ${process.env.FAL_API_KEY}` }
    };
    const result = await fal.subscribe("fal-ai/realistic-vision", options);
    if (result.images && result.images.length > 0) {
        return result.images[0].url;
    } else {
        throw new Error("No images generated.");
    }
}

async function uploadToPinata(imageUrl, contact) {
    const response = await axios_1.default.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data, 'binary');
    const formData = new form_data_1.default();
    formData.append("file", imageBuffer, "image.png");
    formData.append("pinataMetadata", JSON.stringify({ keyvalues: { contact: contact } }));
    const pinataResponse = await axios_1.default.post("https://api.pinata.cloud/pinning/pinFileToIPFS", formData, {
        headers: {
            "Content-Type": `multipart/form-data; boundary=${formData.getBoundary()}`,
            Authorization: `Bearer ${process.env.PINATA_JWT}`
        }
    });
    if (pinataResponse.status === 200) {
        await ctx.reply(`Image submitted successfully! You can view it here: https://gateway.pinata.cloud/ipfs/${pinataResponse.data.IpfsHash}`);
    } else {
        throw new Error('Failed to upload to Pinata');
    }
}

const webhookUrl = `https://${process.env.DOMAIN}/telegram/${process.env.BOT_TOKEN}`;

async function setWebhookWithRetry(url, retries = 3) {
    try {
        await bot.api.setWebhook(url);
        console.log(`Webhook set to ${url}`);
        bot.start();
    } catch (err) {
        if (retries > 0 && err.error_code === 429 && err.parameters.retry_after) {
            const retryAfter = err.parameters.retry_after * 1000;
            console.log(`Retrying to set webhook in ${retryAfter} ms...`);
            setTimeout(() => setWebhookWithRetry(url, retries - 1), retryAfter);
        } else {
            console.error('Failed to set webhook:', err);
        }
    }
}

bot.api.deleteWebhook().then(() => {
    console.log("Deleted previous webhook, if any.");
    setWebhookWithRetry(webhookUrl);
}).catch(err => {
    console.error('Failed to delete webhook:', err);
});

console.log(`Server running on port ${process.env.PORT}`);
