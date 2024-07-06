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
const { http, createPublicClient, encodeFunctionData } = require("viem");
const { baseSepolia } = require("viem/chains");
const { createSmartAccountClient, ENTRYPOINT_ADDRESS_V06 } = require("permissionless");
const { privateKeyToSimpleSmartAccount } = require("permissionless/accounts");
const { createPimlicoPaymasterClient } = require("permissionless/clients/pimlico");

// Replace "YOUR RPC URL" with the corresponding environment variable
async function init() {
    const rpcUrl = process.env.RPC_URL;
    const publicClient = createPublicClient({
      transport: http(rpcUrl),
    });
  
    const privateKey = process.env.PRIVATE_KEY;
    const simpleAccount = await privateKeyToSimpleSmartAccount(publicClient, {
      privateKey: privateKey,
      factoryAddress: "0x9406Cc6185a346906296840746125a0E44976454",
      entryPoint: ENTRYPOINT_ADDRESS_V06,
    });
  
    const cloudPaymaster = createPimlicoPaymasterClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
      entryPoint: ENTRYPOINT_ADDRESS_V06,
    });
  
    const smartAccountClient = createSmartAccountClient({
      account: simpleAccount,
      chain: baseSepolia,
      bundlerTransport: http(rpcUrl),
      middleware: {
        sponsorUserOperation: cloudPaymaster.sponsorUserOperation,
      },
    });

  

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
        imageUrl: null,
        metadataUrl: null,
        walletAddress: null,
        generationCount: 0
    }),
}));

bot.command("start", async (ctx) => {
    ctx.session.answers = [];
    ctx.session.contact = null;
    ctx.session.imageUrl = null;
    ctx.session.metadataUrl = null;
    ctx.session.walletAddress = null;
    ctx.session.generationCount = 0;
    await ctx.reply("Welcome Aspiring Detectives. To pass your first test you must describe one of the leaders who resides in our hall of fame. What kind of hero/heroine were they (film noir, ninja, cowboy, classic hollywood detective, alien, knight, etc ? ");
});

bot.on("message:text", async (ctx) => {
    const session = ctx.session;
    if (!ctx.msg.text) return; // Ensure text exists to avoid undefined errors

    if (session.generationCount >= 5) {
        await ctx.reply("You've reached the maximum number of generations.");
        return;
    }

    if (session.answers.length < 3) {
        session.answers.push(ctx.msg.text);
        if (session.answers.length === 1) {
            await ctx.reply("Did they have always look at the camera or was it at a specific side or angle?");
        } else if (session.answers.length === 2) {
            await ctx.reply("What about their eyes, did they wear sunglasses, or have special eye colors?");
        } else {
            const prompt = `An editorial photograph of a glossy black and white, 1920's inspire image of a ${session.answers[0]}, the face has ${session.answers[1]}, and is positioned at ${session.answers[2]}, sleek, 3D, symmetrical, 4k, award-winning, crisp, detailed`;
            await ctx.reply("Creating your agent ...");
            try {
                const imageUrl = await generateImage(prompt);
                session.imageUrl = imageUrl;
                session.generationCount += 1;
                await ctx.reply(`Here is your image: ${imageUrl}`);
                await ctx.reply("Do you want to mint this image as an NFT? Reply 'yes' or 'no'.");
            } catch (error) {
                await ctx.reply("Failed to generate image.");
            }
        }
    } else if (ctx.msg.text.toLowerCase() === "yes" && session.imageUrl) {
        await ctx.reply("Uploading image to IPFS...");
        try {
            const metadataUrl = await uploadToPinata(session.imageUrl);
            session.metadataUrl = metadataUrl;
            await ctx.reply("Please provide your wallet address.");
        } catch (error) {
            await ctx.reply("Failed to upload to IPFS.");
        }
    } else if (ctx.msg.text.toLowerCase() === "no") {
        await ctx.reply("Restarting...");
        session.answers = [];
        session.contact = null;
        session.imageUrl = null;
        session.metadataUrl = null;
        session.walletAddress = null;
        session.generationCount = 0;
        await ctx.reply("Welcome Aspiring Detectives. To pass your first test you must describe one of the leaders who resides in our hall of fame. What kind of hero/heroine were they (film noir, ninja, cowboy, classic hollywood detective, alien, knight, etc ? ");
    } else if (session.metadataUrl && ethers_1.ethers.utils.isAddress(ctx.msg.text)) {
        session.walletAddress = ctx.msg.text;
        await ctx.reply("Minting your NFT, this may take a few moments...");
        try {
            const transactionHash = await mintNFT(session.walletAddress, session.metadataUrl);
            await ctx.reply(`NFT minted successfully! Transaction hash: [${transactionHash}](https://explorer.mantle.xyz/tx/${transactionHash}), Metadata: [View on IPFS](${session.metadataUrl})`, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error("Error during minting NFT:", error);
            await ctx.reply("Minting failed due to a blockchain error. Please try again later.");
        }
    } else {
        await ctx.reply("Please reply 'yes' to mint or 'no' to restart.");
    }
});

async function generateImage(prompt) {
    const options = {
        input: {
            prompt,
            num_inference_steps: 35,
            guidance_scale: 8,
            image_size: "square_hd"
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

async function uploadToPinata(imageUrl) {
    try {
        const response = await axios_1.default.get(imageUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data, 'binary');
        const formData = new form_data_1.default();
        formData.append("file", imageBuffer, "image.png");
        const pinataResponse = await axios_1.default.post("https://api.pinata.cloud/pinning/pinFileToIPFS", formData, {
            headers: {
                "Content-Type": `multipart/form-data; boundary=${formData.getBoundary()}`,
                Authorization: `Bearer ${process.env.PINATA_JWT}`
            }
        });
        return `https://gateway.pinata.cloud/ipfs/${pinataResponse.data.IpfsHash}`;
    } catch (error) {
        throw new Error('Failed to upload to Pinata');
    }
}

async function mintNFT(walletAddress, metadataUrl, smartAccountClient, cloudPaymaster) {
    const provider = new ethers_1.ethers.providers.JsonRpcProvider("https://sepolia.base.org");
    const signer = new ethers_1.ethers.Wallet(process.env.MAINNET_PRIVATE_KEY?.trim(), provider);
    const contract = new ethers_1.ethers.Contract("0x3a18694852924178f20b61d18b0195c2db1e4c00", contractABI, signer);

    try {
      const transactionResponse = await smartAccountClient.sendTransaction({
        account: smartAccountClient.account,
        to: contract.address,
        data: contract.interface.encodeFunctionData("mintNFT", [walletAddress, metadataUrl]),
        value: ethers_1.ethers.utils.parseEther("0"),
      });
      await transactionResponse.wait();
      return transactionResponse.hash;
    } catch (error) {
      console.error("Error during minting NFT:", error);
      throw error;
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
}

init();