const Groq = require("groq-sdk")
const { z } = require("zod")
const puppeteer = require("puppeteer")

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
})

const MODEL = "openai/gpt-oss-120b" // check console.groq.com/docs/models for current available models

async function invokeGroqAi() {
    const res = await groq.chat.completions.create({
        model: MODEL,
        messages: [
            { role: "user", content: "Hello! Explain what is interview?" }
        ],
    })
    console.log(res.choices[0].message.content)
}

const interviewReportSchema = z.object({
    matchScore: z.number().describe("A score between 0 and 100 indicating how well the candidate's profile matches the job describe"),
    technicalQuestions: z.array(z.object({
        question: z.string().describe("The technical question can be asked in the interview"),
        intention: z.string().describe("The intention of interviewer behind asking this question"),
        answer: z.string().describe("How to answer this question, what points to cover, what approach to take etc.")
    })).describe("Technical questions that can be asked in the interview along with their intention and how to answer them"),
    behavioralQuestions: z.array(z.object({
        question: z.string().describe("The technical question can be asked in the interview"),
        intention: z.string().describe("The intention of interviewer behind asking this question"),
        answer: z.string().describe("How to answer this question, what points to cover, what approach to take etc.")
    })).describe("Behavioral questions that can be asked in the interview along with their intention and how to answer them"),
    skillGaps: z.array(z.object({
        skill: z.string().describe("The skill which the candidate is lacking"),
        severity: z.enum(["low", "medium", "high"]).describe("The severity of this skill gap, i.e. how important is this skill for the job and how much it can impact the candidate's chances")
    })).describe("List of skill gaps in the candidate's profile along with their severity"),
    preparationPlan: z.array(z.object({
        day: z.number().describe("The day number in the preparation plan, starting from 1"),
        focus: z.string().describe("The main focus of this day in the preparation plan, e.g. data structures, system design, mock interviews etc."),
        tasks: z.array(z.string()).describe("List of tasks to be done on this day to follow the preparation plan, e.g. read a specific book or article, solve a set of problems, watch a video etc.")
    })).describe("A day-wise preparation plan for the candidate to follow in order to prepare for the interview effectively"),
    title: z.string().describe("The title of the job for which the interview report is generated"),
})

// Compact hand-written schema description — far fewer tokens than zodToJsonSchema's full dump
const interviewReportCompactSchema = `{
  "matchScore": number (0-100),
  "technicalQuestions": [{ "question": string, "intention": string, "answer": string }] (exactly 3 items),
  "behavioralQuestions": [{ "question": string, "intention": string, "answer": string }] (exactly 3 items),
  "skillGaps": [{ "skill": string, "severity": "low"|"medium"|"high" }] (2-4 items),
  "preparationPlan": [{ "day": number, "focus": string, "tasks": string[] }] (exactly 5 items),
  "title": string
}`

const resumePdfSchema = z.object({
    html: z.string().describe("The HTML content of the resume which can be converted to PDF using any library like puppeteer")
})

const resumePdfCompactSchema = `{
  "html": string (full HTML document as a single string)
}`

// Helper: ask Groq for JSON matching a schema, with validation + retry on failure
async function generateStructuredJson({ prompt, schema, schemaName, compactSchemaDescription, maxTokens = 3000 }) {
    const systemPrompt = `You are a JSON generation engine. Respond with ONLY a valid JSON object — no markdown, no code fences, no explanation before or after.

The JSON object "${schemaName}" must have this exact shape:
${compactSchemaDescription}

Rules:
- Include every field for every array item, no omissions.
- Use only the exact enum values specified, nothing else.
- Keep every text field concise so the full response fits within the token budget.
- Do not truncate — finish every array item completely before starting the next.`

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
    ]

    const maxAttempts = 2
    let lastError

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const completion = await groq.chat.completions.create({
                model: MODEL,
                messages,
                response_format: { type: "json_object" },
                temperature: 0.3,
                max_tokens: maxTokens
            })

            const raw = completion.choices[0].message.content
            const parsed = JSON.parse(raw)
            const validated = schema.parse(parsed) // throws if it doesn't match shape
            return validated
        } catch (err) {
            lastError = err
            console.error(`Attempt ${attempt} failed:`, err.message)
            messages.push({
                role: "user",
                content: `Previous response was invalid or incomplete. Respond again with the COMPLETE, valid JSON matching the schema exactly — every field present, kept concise.`
            })
        }
    }

    throw new Error(`Failed to generate valid structured JSON after ${maxAttempts} attempts: ${lastError.message}`)
}

async function generateInterviewReport({ resume, selfDescription, jobDescription }) {
    // Trim resume to keep total request tokens within the free-tier TPM budget
    const trimmedResume = (resume || "").slice(0, 3000)
    const trimmedSelfDescription = (selfDescription || "").slice(0, 800)
    const trimmedJobDescription = (jobDescription || "").slice(0, 1500)

    const prompt = `Generate an interview report for a candidate with the following details:
Resume: ${trimmedResume}
Self Description: ${trimmedSelfDescription}
Job Description: ${trimmedJobDescription}

Generate exactly 3 technical questions, 3 behavioral questions, 2-4 skill gaps, and a 5-day preparation plan. Keep every text field short (1-3 sentences).`

    return await generateStructuredJson({
        prompt,
        schema: interviewReportSchema,
        schemaName: "InterviewReport",
        compactSchemaDescription: interviewReportCompactSchema,
        maxTokens: 3000
    })
}

async function generatePdfFromHtml(htmlContent) {
    const browser = await puppeteer.launch()
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" })

    const pdfBuffer = await page.pdf({
        format: "A4", margin: {
            top: "20mm",
            bottom: "20mm",
            left: "15mm",
            right: "15mm"
        }
    })

    await browser.close()

    return pdfBuffer
}

async function generateResumePdf({ resume, selfDescription, jobDescription }) {
    const trimmedResume = (resume || "").slice(0, 3000)
    const trimmedSelfDescription = (selfDescription || "").slice(0, 800)
    const trimmedJobDescription = (jobDescription || "").slice(0, 1500)

    const prompt = `Generate a resume for a candidate with the following details:
Resume: ${trimmedResume}
Self Description: ${trimmedSelfDescription}
Job Description: ${trimmedJobDescription}

The resume should be tailored to the job description, highlighting relevant strengths and experience. Use well-structured, simple, professional HTML — not overly styled. It should not sound AI-generated. Keep it ATS-friendly (parsable plain text within the HTML) and limited to roughly 1-2 pages of content. Focus on quality and relevance over length.`

    const result = await generateStructuredJson({
        prompt,
        schema: resumePdfSchema,
        schemaName: "ResumeHtml",
        compactSchemaDescription: resumePdfCompactSchema,
        maxTokens: 3500 // HTML output needs a bit more room than the report JSON
    })

    const pdfBuffer = await generatePdfFromHtml(result.html)

    return pdfBuffer
}

module.exports = { generateInterviewReport, generateResumePdf, invokeGroqAi }