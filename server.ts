console.log("Initializing API Server...");
import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();
console.log("Environment configuration loaded.");

// --- DEFENSIVE BOOT STRAPPING MECHANISM ---
import admin from 'firebase-admin';

function initializeGoogleServiceAccount() {
  try {
    const rawServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    
    if (!rawServiceAccount) {
      console.warn("⚠️ [Service Account] GOOGLE_SERVICE_ACCOUNT_KEY is missing. Firebase Admin integrations will not work until configured.");
      return;
    }

    // Defensively target both Vercel newline anomalies and literal slash escapes
    const sanitizedServiceAccount = rawServiceAccount
      .replace(/\\n/g, '\n')
      .trim();

    const serviceAccountObj = JSON.parse(sanitizedServiceAccount);
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = sanitizedServiceAccount; // Inject sanitized payload back to ENV
    
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountObj)
      });
    }

    console.log("🚀 [Service Account SDK] Initialized successfully with defensive regex parsing.");
  } catch (error: any) {
    console.error("🚨 [CRITICAL BACKEND CRASH] Service Account initialization failed on boot:", error.message);
    // Do not let the raw exception crash the worker thread silently, wrap it cleanly
  }
}
initializeGoogleServiceAccount();

// Rate Limit Defense: 3 API Keys
const API_KEYS = [
  process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || "",
  process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY || "",
  process.env.GEMINI_API_KEY_3 || process.env.GEMINI_API_KEY || ""
].filter(Boolean);

let currentKeyIndex = 0;

function getGeminiClient() {
  if (API_KEYS.length === 0) {
    throw new Error("No Gemini API keys configured.");
  }
  const apiKey = API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  return new GoogleGenAI({ apiKey });
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// JWT Helper for Firebase ID Tokens
  const decodeFirebaseToken = (token: string) => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], "base64").toString("utf8");
      return JSON.parse(payload);
    } catch (e) {
      return null;
    }
  };

  // Safe Firestore REST API fetch for securing user roles
  const getUserRoleFromFirestore = async (userId: string, idToken: string): Promise<string | null> => {
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
    if (!projectId) {
      return null;
    }
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${idToken}`
        }
      });
      if (!res.ok) {
        console.error(`Firestore API check failed for user ${userId}:`, res.status);
        return null;
      }
      const docData = await res.json();
      return docData?.fields?.role?.stringValue || null;
    } catch (error) {
      console.error(`Error fetching user role from Firestore REST API:`, error);
      return null;
    }
  };

  // Rate Limit Defense: In-memory store for student AI cooldown tracking (15 seconds)
  const studentAICooldowns = new Map<string, number>();

  // Simple periodic cleanup to prevent memory growth (removes expired keys older than 1 minute)
  setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of studentAICooldowns.entries()) {
      if (now - timestamp > 60000) {
        studentAICooldowns.delete(key);
      }
    }
  }, 60000);

  // Authenticated Robust Cooldown Filter
  const aiCooldownMiddleware = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    let userId = req.headers["x-user-id"] as string;
    let userRole = req.headers["x-user-role"] as string;

    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.substring(7);
      const decoded = decodeFirebaseToken(idToken);
      if (decoded && decoded.user_id) {
        userId = decoded.user_id;
        // Authenticate token to fetch exact role from Firestore DB
        const dbRole = await getUserRoleFromFirestore(userId, idToken);
        if (dbRole) {
          userRole = dbRole;
        }
      }
    }

    if (userRole === "student" && userId) {
      const lastRequest = studentAICooldowns.get(userId);
      const now = Date.now();
      if (lastRequest && now - lastRequest < 15000) {
        const timeLeft = Math.ceil((15000 - (now - lastRequest)) / 1000);
        return res.status(429).json({
          error: `Bạn đang trong trạng thái đóng băng thời gian gọi AI (Cooldown 15 giây). Hãy đợi thêm ${timeLeft} giây nữa.`
        });
      }
      studentAICooldowns.set(userId, now);
    }
    next();
  };





  // Agent 2: Dynamic Router Agent (Deep Extract)
  app.post("/api/agent2/explain", aiCooldownMiddleware, async (req, res) => {
    try {
      const { term, definition, subject } = req.body;
      const ai = getGeminiClient();
      
      let prompt = "";
      if (subject === "english") {
        prompt = `Mày là Chuyên gia Ngôn ngữ học. Phân tích từ vựng tiếng Anh "${term}" (Định nghĩa: ${definition}). 
YÊU CẦU QUAN TRỌNG: Hãy viết lời giải thích súc tích, đầy đủ ý nghĩa với độ dài tổng cộng khoảng 100 đến 200 từ. Tránh quá ngắn cụt lủn cũng không dài dòng.
Trình bày kết quả theo cấu trúc markdown chuẩn, BẮT BUỘC dùng nhiều emoji/icon sinh động phù hợp ngữ cảnh, chia thành các danh mục sau:
1. Từ loại & Phiên âm IPA 🔤 (Có phiên âm chuẩn và phân loại từ cụ thể)
2. Nghĩa tiếng Việt & Giải nghĩa chi tiết 🇻🇳 (Dịch rõ nghĩa cảnh dùng thông dụng nhất)
3. Etymology (Nguồn gốc lịch sử hình thành từ) 🏛️ (Kể câu chuyện lịch sử ngắn gọn, dễ hiểu về từ này)
4. 2 câu ví dụ thực tế phong phú kèm dịch nghĩa 📝 (Sử dụng ngữ cảnh giao tiếp tự nhiên)
Chỉ trả ra nội dung phân tích (markdown).`;
      } else {
        prompt = `Mày là Giáo sư Khoa học/Xã hội. Phân tích khái niệm/định luật "${term}" (Định nghĩa: ${definition}).
YÊU CẦU QUAN TRỌNG: Hãy giải thích ý nghĩa mang tính giáo dục sâu sắc, có độ dài tổng cộng khoảng 100 đến 200 từ để vừa đủ tiếp thu nhanh vừa giàu chiều sâu.
Trình bày kết quả bằng markdown, BẮT BUỘC dùng nhiều emoji/icon sinh động, chia thành các danh mục sau:
1. Định nghĩa chính thức & Bản chất cốt lõi 📖 (1-2 câu định nghĩa súc tích)
2. Công thức hoặc Bối cảnh ra đời 🧪 (Giải thích cụ thể biểu thức hoặc bối cảnh lịch sử tìm ra, bọc tất cả công thức/biểu thức toán/lý/hóa trong dấu $ cho inline và $$ cho block để thư viện MathJax/KaTeX render)
3. 2 ứng dụng thực tiễn nổi bật 🚀 (Mỗi ứng dụng giải thích ngắn gọn lợi ích thực tế)
4. Một mẹo ghi nhớ tinh tế 🧠
BẮT BUỘC ép hiển thị LaTeX chuẩn: Mọi công thức toán/lý/hóa phải bọc trong dấu $ cho inline và $$ cho block toán học. Chỉ trả ra nội dung phân tích (markdown).`;
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
        // removed responseMimeType since it's HTML/markdown
      });
      
      res.json({ result: response.text });
    } catch (error) {
      console.error("Agent 2 Error:", error);
      res.status(500).json({ error: true, message: "Failed to explain" });
    }
  });

  // Mock Exam Generator
  app.post("/api/exam/generate", aiCooldownMiddleware, async (req, res) => {
    try {
      const { decks, examType, count } = req.body;
      const ai = getGeminiClient();

      const contextData = JSON.stringify(decks.map((d: any) => ({
        deckId: d.id,
        deckTitle: d.title,
        cards: d.cards.map((c: any) => ({ cardId: c.id, front: c.front, back: c.back }))
      })));

      let prompt = `Bạn là một AI được thiết kế để tạo bài kiểm tra tự động từ các thẻ (flashcards) được cung cấp.
Dữ liệu Flashcards:
${contextData}

Yêu cầu: Hãy tạo một đề thi gồm ${count || 10} câu hỏi trắc nghiệm (Multiple Choice) từ các flashcards này. Mỗi thẻ có thể dùng để tạo câu hỏi về nội dung "front" hỏi "back" hoặc ngược lại, hoặc suy luận từ nội dung. Các lựa chọn sai (distractors) phải hợp lý và không quá dễ đoán. Đảo lộn vị trí đáp án đúng. Nghĩa là correctAnswerIndex có thể từ 0 đến 3 ngẫu nhiên.
BẮT BUỘC ĐỊNH DẠNG: Chỉ trả về ĐÚNG MỘT MẢNG JSON duy nhất, không markdown code block, không text thừa.
Định dạng JSON:
[
  {
    "cardId": "string - ID của thẻ đang được kiểm tra",
    "deckId": "string - ID của deck chứa thẻ này",
    "question": "string - Câu hỏi trắc nghiệm",
    "options": ["string", "string", "string", "string"],
    "correctAnswerIndex": number - Chỉ số của đáp án đúng (từ 0 đến 3),
    "explanation": "string - Giải thích ngắn vì sao lại chọn đáp án này"
  }
]`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.3
        }
      });

      res.json({ result: response.text });
    } catch (error) {
      console.error("Exam Generation Error:", error);
      res.status(500).json({ error: true, message: "Failed to generate exam" });
    }
  });

  // Agent 4: Convert Document to JSON (Streaming API)
  app.post("/api/convert-document", aiCooldownMiddleware, async (req, res) => {
    try {
      const { fileData, mimeType } = req.body;
      const ai = getGeminiClient();

      if (!fileData) {
        return res.status(400).json({ error: "Không tìm thấy dữ liệu file" });
      }

      const systemPrompt = `Bạn là chuyên gia được lập trình để chuyển hóa tài liệu giáo dục thành Flashcard JSON.
Nhiệm vụ: Phân tích tài liệu được cung cấp và trích xuất các thông tin/kiến thức quan trọng nhất, tạo ra các flashcards bao gồm câu hỏi (front) và giải thích (back).
BẮT BUỘC ĐỊNH DẠNG: Chỉ trả về mảng JSON duy nhất, KHÔNG chứa ký tự markdown (như \`\`\`json), KHÔNG lời chào hỏi.
Cấu trúc mẫu: [{"front": "Khái niệm A", "back": "Định nghĩa A"}]`;

      const parts: any[] = [];
      parts.push({ text: systemPrompt });
      
      const base64Data = fileData.split(',').pop() || fileData;

      parts.push({
        inlineData: {
          data: base64Data,
          mimeType: mimeType || "application/pdf"
        }
      });

      const responseStream = await ai.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: parts
      });

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');

      for await (const chunk of responseStream) {
        res.write(chunk.text);
      }
      res.end();

    } catch (error: any) {
      console.error("Agent 4 Convert Document Error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: true, message: error.message || "Lỗi xử lý file" });
      } else {
        res.end(`\n\n[ERROR: ${error.message}]`);
      }
    }
  });

  // AI Quick Lesson Plan Generator (Tạo Giáo Án Nhanh)
  app.post("/api/agent/lesson-plan", aiCooldownMiddleware, async (req, res) => {
    try {
      const { topic } = req.body;
      if (!topic) return res.status(400).json({ error: "No topic provided." });
      
      const ai = getGeminiClient();
      let prompt = `Bạn là một chuyên gia thiết kế chương trình giảng dạy (Instructional Designer).
Hãy tạo một giáo án học tập tối ưu cho chủ đề: "${topic}".
Giáo án cần đảm bảo đủ kiến thức sâu sắc, logic và dễ hiểu.
KHÔNG sử dụng Markdown code block. TRẢ VỀ ĐÚNG MỘT OBJECT JSON DUY NHẤT.

Định dạng JSON:
{
  "roadmap": [
    { "step": 1, "title": "Tên bài học", "description": "Mô tả ngắn gọn" }
  ],
  "concepts": [
    { "term": "Khái niệm", "definition": "Định nghĩa hoặc giải thích dễ hiểu" }
  ],
  "flashcards": [
    { "front": "Câu hỏi/Từ khóa", "back": "Câu trả lời/Định nghĩa", "subject": "${topic}" }
  ]
}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.3
        }
      });
      
      res.json({ result: response.text });
    } catch (error: any) {
      console.error("Lesson Plan Error:", error);
      res.status(500).json({ error: true, message: error.message || "Failed to generate lesson plan" });
    }
  });

  // Agent 3: Socratic & Context-Aware Assistant
  app.post("/api/agent3/chat", aiCooldownMiddleware, async (req, res) => {
    try {
      const { message, context, mode, mcqData, difficulty, sessionId } = req.body;
      const ai = getGeminiClient();
      
      let systemPrompt = `Mày là Agent 3 - 'Socrates AI Coach', gia sư học tập chủ động. QUY TẮC BẮT BUỘC:
1. SOCRATIC METHOD: KHÔNG BAO GIỜ giải bài tập hộ hay cho đáp án trực tiếp. Khi học sinh hỏi, hãy gợi ý từng bước, đưa manh mối và kết thúc bằng một câu hỏi ngược để học sinh tự suy luận.
2. CONTEXT-AWARE: Mày sẽ nhận được Context ẩn (thẻ học sinh đang xem). Nếu học sinh dùng từ 'Cái này', 'Từ này', hãy tự động liên kết với Context đó để trả lời.
3. FORMATTING: Ngắn gọn, thân thiện, dùng LaTeX ($$, $) cho mọi công thức Toán/Lý/Hóa.`;

      if (mode === "quiz") {
          const diffLevel = difficulty || "medium";
          systemPrompt += `\n\nNhiệm vụ: Tạo một trò chơi trắc nghiệm 3 câu hỏi liên tiếp dựa trên context thẻ yếu được cung cấp. Cấp độ khó: ${diffLevel}. Đầu vào là yêu cầu người dùng: ${message}`;
          if (mcqData) {
            let difficultyGuidance = "Cấp độ trung bình.";
            if (diffLevel === "easy") difficultyGuidance = "Cấp độ dễ: Hỏi trực tiếp định nghĩa cơ bản, nhận biết trực tiếp.";
            if (diffLevel === "medium") difficultyGuidance = "Cấp độ trung bình: Yêu cầu hiểu sâu hơn, áp dụng cơ bản.";
            if (diffLevel === "hard") difficultyGuidance = "Cấp độ khó: Đánh đố, vận dụng cao, suy luận logic tổng hợp.";
            
            const mcqPrompt = `Tạo một bài Test 15 câu trắc nghiệm MCQ dựa trên danh sách các thẻ yếu sau đây. \nĐộ khó: ${difficultyGuidance}\nTrả về đúng 1 mảng JSON chứa các object: {"question": "...", "options": ["A...","B...","C...","D..."], "correctIndex": 0..3, "explanation": "..."}. KHÔNG trả về gì khác ngoài JSON.\nDữ liệu hổng kiến thức: ${JSON.stringify(mcqData)}`;
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: mcqPrompt,
                config: { responseMimeType: "application/json" }
            });
            return res.json({ result: response.text });
          }
      }
      
      const fullPrompt = `Ngữ cảnh ẩn (Hidden Context): ${context}\n\nHọc sinh: ${message}`;

      let previousHistory: any[] = [];
      let dbRef: admin.firestore.DocumentReference | null = null;
      
      if (mode === "chat" && sessionId && admin.apps.length > 0) {
        try {
          const db = admin.firestore();
          // Use 'chat_sessions' in Firestore
          dbRef = db.collection("chat_sessions").doc(sessionId);
          const doc = await dbRef.get();
          if (doc.exists) {
            const data = doc.data();
            if (data && data.messages && Array.isArray(data.messages)) {
              previousHistory = data.messages;
            }
          }
        } catch(e) {
          console.error("Firestore retrieval error:", e);
          previousHistory = []; 
        }
      }

      const contents = [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "model", parts: [{ text: "Đã hiểu." }] },
          ...previousHistory,
          { role: "user", parts: [{ text: fullPrompt }] }
      ];

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents
      });

      const responseText = response.text || "";

      if (mode === "chat" && dbRef) {
        try {
          await dbRef.set({
            messages: admin.firestore.FieldValue.arrayUnion(
              { role: "user", parts: [{ text: fullPrompt }] },
              { role: "model", parts: [{ text: responseText }] }
            ),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } catch(e) {
          console.error("Firestore arrayUnion error:", e);
        }
      }
      
      res.json({ result: responseText });
    } catch (error: any) {
      console.error("Agent 3 Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate context" });
    }
  });

// Vite middleware for development
async function setupViteAndStart() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

if (!process.env.VERCEL) {
  setupViteAndStart();
}

export default app;
