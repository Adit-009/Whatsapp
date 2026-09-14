import 'dotenv/config'
import express from 'express'
import connectDB from './config/db.js'
import { seedDefaultTemplate } from './models/MessageTemplate.js'
import whatsappRoutes from './routes/whatsapp.routes.js'

const app = express()

// Middleware for body parsing & static files
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static('public'))

// Set EJS as view engine
app.set('view engine', 'ejs')

// Register WhatsApp module routes
app.use('/', whatsappRoutes)

// Connect to MongoDB, seed defaults, then start server
async function startServer() {
  await connectDB()
  await seedDefaultTemplate()

  app.listen(3000, () => {
    console.log(`App is running on http://localhost:3000`)
  })
}

startServer()