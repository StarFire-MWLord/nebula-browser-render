import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 10000);

app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.static(path.join(__dirname,'public'), {extensions:['html']}));
app.get('/health', (_req,res)=>res.status(200).json({ok:true}));
app.get('*', (_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(port,'0.0.0.0',()=>console.log(`Nebula Browser listening on 0.0.0.0:${port}`));
