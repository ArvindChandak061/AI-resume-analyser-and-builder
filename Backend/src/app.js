const express = require("express")
const cookieParser = require("cookie-parser")
const cors = require("cors")

const app = express()

app.use(express.json())
app.use(cookieParser())

// Put all allowed URLs in an array
const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL // Will read from hosting settings
].filter(Boolean) // Cleans up empty values

app.use(cors({
  origin: function (origin, callback) {
    // Allow Postman/mobile tools or matching origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error("CORS error: Not allowed"))
    }
  },
  credentials: true
}))

/* require all the routes here */
const authRouter = require("./routes/auth.routes")
const interviewRouter = require("./routes/interview.routes")

/* using all the routes here */
app.use("/api/auth", authRouter)
app.use("/api/interview", interviewRouter)

module.exports = app