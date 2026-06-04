import React, { useState, useRef, useEffect } from "react";
import { store } from "../lib/store";
import { MessageCircle, X, Send, Bot, CheckCircle } from "lucide-react";
import { cn } from "../lib/utils";
import { safeRequest } from "../utils/apiClient";
import ReactMarkdown from "react-markdown";
import { useAICooldown } from "../lib/cooldown";
import { auth } from "../lib/firebase";
import { v4 as uuidv4 } from "uuid";

export default function Agent3Widget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{role: "user"|"ai", text: string}[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [quizData, setQuizData] = useState<any>(null); // For MCQ
  const [sessionId] = useState(() => uuidv4());

  const user = store.getCurrentUser();
  const { cooldownRemaining, startCooldown } = useAICooldown(user);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, quizData]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    if (user && user.role === "student" && cooldownRemaining > 0) {
      setMessages(prev => [...prev, { role: "ai", text: `⏳ Bạn ơi, vui lòng đợi thêm ${cooldownRemaining} giây để đặt câu hỏi tiếp theo nhé!` }]);
      return;
    }
    
    setMessages(prev => [...prev, { role: "user", text: input }]);
    const currentInput = input;
    setInput("");
    setIsLoading(true);

    if (user && user.role === "student") {
      startCooldown();
    }

    try {
      const idToken = await auth.currentUser?.getIdToken() || "";
      // Find current context
      const decks = store.getDecks();
      // simplified hidden context
      const context = "Student is studying. Deck info available.";

      if (currentInput.trim().toLowerCase().startsWith("/quiz")) {
        const difficulty = currentInput.trim().toLowerCase().replace("/quiz", "").trim() || "medium";
        
        // Collect 15 most weak cards
        let allWeak: any[] = [];
        decks.forEach(d => {
          allWeak = allWeak.concat(d.cards.filter(c => c.isHard || c.mastery < 50));
        });
        const top15 = allWeak.sort((a,b) => a.mastery - b.mastery).slice(0, 15);

        const res = await safeRequest("/api/agent3/chat", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${idToken}`,
            "x-user-id": user?.id || "",
            "x-user-role": user?.role || ""
          },
          body: JSON.stringify({ message: currentInput, context, mode: "quiz", mcqData: top15, difficulty, sessionId })
        });

        if (!res.ok) {
          const errData = await res.json();
          if (res.status === 429) {
            setMessages(prev => [...prev, { role: "ai", text: `⏳ ${errData.error || "Bạn đang gọi AI quá nhanh. Hãy chờ hoặc nạp năng lượng!"}` }]);
            setIsLoading(false);
            return;
          }
          throw new Error(errData.message || (typeof errData.error === 'string' ? errData.error : "API Agent 3 lỗi"));
        }

        const data = await res.json();
        const jsonStr = data.result.replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
        const parsed = JSON.parse(jsonStr);
        setQuizData(parsed);
      } else {
        const res = await safeRequest("/api/agent3/chat", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${idToken}`,
            "x-user-id": user?.id || "",
            "x-user-role": user?.role || ""
          },
          body: JSON.stringify({ message: currentInput, sessionId, mode: "chat" })
        });

        if (!res.ok) {
          const errData = await res.json();
          if (res.status === 429) {
            setMessages(prev => [...prev, { role: "ai", text: `⏳ ${errData.error || "Bạn đang gọi AI quá nhanh. Hãy chờ hoặc nạp năng lượng!"}` }]);
            setIsLoading(false);
            return;
          }
          throw new Error(errData.message || (typeof errData.error === 'string' ? errData.error : "API Agent 3 lỗi"));
        }

        const data = await res.json();
        setMessages(prev => [...prev, { role: "ai", text: data.result }]);
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { role: "ai", text: error?.message || "Tín hiệu bị nhiễu do bão mặt trời (Error 500). Vui lòng thử lại." }]);
    }
    setIsLoading(false);
  };

  const QuizRenderer = () => {
    const [currentQ, setCurrentQ] = useState(0);
    const [score, setScore] = useState(0);
    const [finished, setFinished] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);
    const [showAnswer, setShowAnswer] = useState(false);

    if (!quizData || !Array.isArray(quizData) || quizData.length === 0) return null;

    if (finished) {
       return (
         <div className="p-4 bg-yellow-500/10 rounded-xl text-center space-y-2 mt-4">
           <h4 className="font-bold">Quiz Complete</h4>
           <p className="text-2xl font-display text-yellow-500">{score} / {quizData.length}</p>
           <button onClick={() => setQuizData(null)} className="text-sm underline opacity-70">Close Quiz</button>
         </div>
       );
    }

    const q = quizData[currentQ];

    const handleAnswer = (idx: number) => {
      setSelected(idx);
      setShowAnswer(true);
      if (idx === q.correctIndex) setScore(s => s + 1);
      
      setTimeout(() => {
        setShowAnswer(false);
        setSelected(null);
        if (currentQ + 1 < quizData.length) setCurrentQ(currentQ + 1);
        else setFinished(true);
      }, 2500);
    };

    return (
      <div className="p-4 bg-black/5 dark:bg-white/5 rounded-xl mt-4 border border-yellow-500/20">
        <div className="flex justify-between items-center text-xs opacity-50 mb-2">
           <span>Q: {currentQ + 1}/{quizData.length}</span>
           <span>Score: {score}</span>
        </div>
        <p className="font-bold mb-4">{q.question}</p>
        <div className="space-y-2">
           {q.options.map((opt: string, i: number) => {
             let bg = "bg-black/10 dark:bg-white/10";
             if (showAnswer) {
               if (i === q.correctIndex) bg = "bg-green-500 text-white";
               else if (i === selected) bg = "bg-red-500 text-white";
             }
             return (
               <button 
                 key={i} 
                 disabled={showAnswer}
                 onClick={() => handleAnswer(i)}
                 className={cn("w-full text-left p-2 rounded-lg text-sm transition", bg, !showAnswer && "hover:bg-yellow-500/20")}
               >
                 {opt}
               </button>
             );
           })}
        </div>
        {showAnswer && (
          <p className="mt-4 text-xs opacity-80 italic animate-in fade-in">
             💡 {q.explanation}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      {!isOpen && (
        <button 
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-yellow-500 text-black rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition z-50 group cursor-pointer"
        >
          <Bot className="w-6 h-6 group-hover:animate-bounce" />
        </button>
      )}

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 bg-stone-900/40 dark:bg-black/40 backdrop-blur-md z-40 transition-all duration-[350ms] ease-out animate-in fade-in"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed inset-0 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[380px] sm:h-[550px] z-50 flex flex-col bg-white/95 dark:bg-zinc-950/98 sm:bg-stone-50/90 sm:dark:bg-zinc-950/90 backdrop-blur-md sm:backdrop-blur-none sm:glass rounded-none sm:rounded-2xl overflow-hidden shadow-2xl sm:border sm:border-stone-200/50 dark:sm:border-white/[0.08] animate-in slide-in-from-bottom-6">
            <div className="bg-yellow-500 text-black p-4 flex justify-between items-center shrink-0">
             <div className="flex items-center gap-2">
               <Bot className="w-5 h-5 animate-pulse" />
               <h3 className="font-bold tracking-tight text-stone-950">Agent 3 - Socratic Coach</h3>
             </div>
             <button onClick={() => setIsOpen(false)} className="hover:bg-black/10 p-1.5 rounded-full transition cursor-pointer"><X className="w-5 h-5" /></button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-stone-50/90 dark:bg-zinc-950/40 sm:bg-transparent sm:dark:bg-transparent">
             <div className="bg-stone-200/50 dark:bg-white/10 p-3 rounded-xl rounded-tl-none w-fit max-w-[85%] text-sm text-stone-800 dark:text-stone-200">
                 Chào bạn. Mình là Gia sư Socratic. Gõ `/quiz easy`, `/quiz medium`, hoặc `/quiz hard` để mình xếp bài test những phần bạn yếu nhé.
             </div>
             
             {messages.map((m, i) => (
                <div key={i} className={cn("text-sm p-3 rounded-xl max-w-[85%] break-words", m.role === "user" ? "bg-yellow-500/30 dark:bg-yellow-500/20 ml-auto rounded-tr-none text-stone-900 dark:text-stone-100" : "bg-stone-200/50 dark:bg-white/10 rounded-tl-none text-stone-800 dark:text-stone-200")}>
                   <ReactMarkdown>{m.text}</ReactMarkdown>
                </div>
             ))}
             
             {quizData && <QuizRenderer />}
             
             {isLoading && (
                <div className="bg-stone-200/50 dark:bg-white/10 p-3 rounded-xl rounded-tl-none w-fit">
                   <div className="flex gap-1">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                      <div className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                   </div>
                </div>
             )}
             <div ref={messagesEndRef} />
          </div>

          <div className="p-4 sm:p-3 border-t border-stone-200/50 dark:border-white/10 bg-stone-100/90 dark:bg-zinc-900/60 sm:bg-stone-50/50 sm:dark:bg-white/5 sticky bottom-0 pb-8 sm:pb-3 shrink-0">
            <div className="flex gap-2">
              <input 
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSend()}
                disabled={cooldownRemaining > 0}
                placeholder={cooldownRemaining > 0 ? `Chờ ${cooldownRemaining}s để sạc năng lượng AI...` : "Ask Socrates... (/quiz, /quiz easy, /quiz hard)"}
                className={cn(
                  "flex-1 bg-transparent border-none focus:outline-none text-sm px-2 text-stone-900 dark:text-stone-100 placeholder:text-stone-500 dark:placeholder:text-stone-400",
                  cooldownRemaining > 0 && "opacity-50 cursor-not-allowed"
                )}
              />
              <button 
                onClick={handleSend}
                disabled={isLoading || !input.trim() || cooldownRemaining > 0}
                className="p-2 bg-yellow-500 text-black rounded-lg disabled:opacity-50 hover:bg-yellow-600 transition cursor-pointer flex items-center justify-center min-w-[32px] min-h-[32px]"
                title={cooldownRemaining > 0 ? `Đang trong cooldown 15s (Còn lại ${cooldownRemaining}s)` : "Gửi"}
              >
                {cooldownRemaining > 0 ? (
                  <span className="text-xs font-black font-mono text-stone-900">{cooldownRemaining}s</span>
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
        </>
      )}
    </>
  );
}
