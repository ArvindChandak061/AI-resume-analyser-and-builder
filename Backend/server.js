require("dotenv").config()
const app = require("./src/app")
const connectToDB = require("./src/config/database")
const {invokeGeminiAi} = require("./src/services/ai.service")

connectToDB()

// invokeGeminiAi()
const port = process.env.PORT || 3000

app.listen(port, () => {
    console.log("Server is running on port 3000")
});