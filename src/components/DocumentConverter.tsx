import React, { useState, useRef } from "react";
import { FileUp, FileText, Check, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";
import ErrorNotification from "./ErrorNotification";
import { store, Deck } from "../lib/store";

export default function DocumentConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  
  const [deckTitle, setDeckTitle] = useState("");
  const [deckSubject, setDeckSubject] = useState("");
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      // Limit to PDF or images, max 5MB for API stability
      if (selected.size > 5 * 1024 * 1024) {
         setError("Kích thước file vượt quá 5MB. Vui lòng chọn file nhẹ hơn.");
         setFile(null);
         return;
      }
      setFile(selected);
      setError(null);
      setSuccessCount(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const selected = e.dataTransfer.files[0];
      if (selected.size > 5 * 1024 * 1024) {
         setError("Kích thước file vượt quá 5MB.");
         setFile(null);
         return;
      }
      setFile(selected);
      setError(null);
      setSuccessCount(null);
    }
  };

  const handleConvert = async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    setSuccessCount(null);
    setProgress("Đang nén file và chuẩn bị tải lên...");
    
    try {
      // 1. Read file to Base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;
      
      const payload = {
        fileData: base64Data,
        mimeType: file.type || "application/pdf"
      };

      setProgress("Đang gửi đến AI Studio (có thể mất tới 30-45 giây)...");
      
      // 2. Stream Fetch
      const user = store.getCurrentUser();
      const idToken = user?.id || "anonymous"; 
      
      const res = await fetch("/api/convert-document", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": idToken,
          "x-user-role": user?.role || "teacher"
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const errObj = await res.json().catch(() => ({}));
        throw new Error(errObj.error || errObj.message || "Lỗi khi gọi API xử lý tài liệu");
      }
      
      if (!res.body) {
         throw new Error("Không nhận được dữ liệu (Stream trống)");
      }

      setProgress("AI đang phân tích và bóc tách dữ liệu...");
      
      const readerBody = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullResponse = "";
      
      while (true) {
        const { done, value } = await readerBody.read();
        if (done) break;
        const chunkStr = decoder.decode(value, { stream: true });
        fullResponse += chunkStr;
        
        // Progress heuristic
        if (fullResponse.length > 0) {
           setProgress(`Đang đọc dữ liệu AI trả về... (${fullResponse.length} bytes)`);
        }
      }
      
      // Checking if error appended at the end
      if (fullResponse.includes("[ERROR:")) {
         throw new Error("AI gặp lỗi khi xử lý stream dữ liệu: " + fullResponse);
      }
      
      setProgress("Đang trích xuất JSON và lưu vảo CSDL...");
      
      // Clean up markdown block if accidentally presented
      let rawJson = fullResponse.trim();
      if (rawJson.startsWith("\`\`\`json")) {
         rawJson = rawJson.substring(7);
      } else if (rawJson.startsWith("\`\`\`")) {
         rawJson = rawJson.substring(3);
      }
      if (rawJson.endsWith("\`\`\`")) {
         rawJson = rawJson.substring(0, rawJson.length - 3);
      }
      rawJson = rawJson.trim();
      
      let parsedCards: any[] = [];
      try {
         parsedCards = JSON.parse(rawJson);
      } catch (jsonErr) {
         console.error("Parse JSON failed:", rawJson);
         throw new Error("AI đã trả về dữ liệu không đúng chuẩn JSON. Vui lòng thử lại với file tài liệu rõ ràng hơn.");
      }
      
      if (!Array.isArray(parsedCards) || parsedCards.length === 0) {
         throw new Error("Không trích xuất được flashcard nào từ tài liệu.");
      }
      
      // Normalize cards
      const validCards = parsedCards.filter(c => c.front && c.back).map(c => ({
         front: c.front.toString(),
         back: c.back.toString()
      }));
      
      if (validCards.length === 0) {
         throw new Error("Tài liệu không đủ cấu trúc để nhận diện Học phần. Vui lòng kiểm tra lại file.");
      }

      // 3. Save to Store/Firestore
      const { v4: uuidv4 } = await import("uuid");
      const deckId = `deck_${uuidv4()}`;
      
      const newDeckObj: Deck = {
        id: deckId,
        title: deckTitle.trim() || `Tài liệu: ${file.name.substring(0, 30)}`,
        subject: deckSubject.trim() || "Tự chọn",
        cards: validCards.map((c) => ({
          id: `card_${uuidv4()}`,
          front: c.front,
          back: c.back,
          subject: deckSubject.trim() || "Tự chọn",
          mastery: 0,
          nextReview: Date.now(),
          isHard: false
        }))
      };

      await store.addDeck(newDeckObj);
      
      setSuccessCount(validCards.length);
      setFile(null);
      setDeckTitle("");
      setDeckSubject("");
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Có lỗi bất ngờ xảy ra");
    } finally {
      setIsProcessing(false);
      setProgress("");
      if (fileInputRef.current) {
         fileInputRef.current.value = "";
      }
    }
  };

  return (
    <section className="bg-stone-50 dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-3xl p-6 md:p-8 relative overflow-hidden">
      <div className="absolute top-0 right-0 bg-blue-500 text-white text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-bl-xl">
        Option Tự động (Edge AI)
      </div>
      
      <div className="flex items-center gap-3 mb-2">
        <div className="p-3 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
          <FileUp className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-display font-semibold">Tự động hoá: Convert Tài liệu to Flashcard</h2>
          <p className="text-sm opacity-70">Tải lên file PDF, Hình ảnh bài học. Hệ thống AI sẽ tự động phân tích và tạo Học phần.</p>
        </div>
      </div>

      {error && <ErrorNotification message={error} onRetry={() => setError(null)} />}
      
      {successCount !== null && (
        <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 p-4 rounded-xl font-medium mb-6 animate-in fade-in slide-in-from-top-2">
          <Check className="w-5 h-5 flex-shrink-0" />
          Đã xử lý và lưu thành công {successCount} thẻ vào hệ thống!
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6 mt-6">
         {/* File Upload Zone */}
         <div>
            <div 
               className={cn(
                  "border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-colors h-48",
                  file ? "border-blue-500 bg-blue-500/5" : "border-stone-300 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-800",
                  isProcessing && "opacity-50 pointer-events-none"
               )}
               onDragOver={handleDragOver}
               onDrop={handleDrop}
               onClick={() => fileInputRef.current?.click()}
            >
               <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  className="hidden" 
                  accept=".pdf,image/*" 
               />
               
               {file ? (
                  <>
                     <FileText className="w-10 h-10 text-blue-500 mb-3" />
                     <p className="font-semibold text-sm line-clamp-1">{file.name}</p>
                     <p className="text-xs opacity-60 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </>
               ) : (
                  <>
                     <FileUp className="w-10 h-10 text-stone-400 dark:text-zinc-600 mb-3" />
                     <p className="font-medium text-sm">Nhấn hoặc Kéo thả file vào đây</p>
                     <p className="text-xs opacity-60 mt-1">Hỗ trợ PDF, PNG, JPG (Tối đa 5MB)</p>
                  </>
               )}
            </div>
         </div>

         {/* Settings & Submission */}
         <div className="space-y-4">
            <div>
               <label className="text-xs font-bold uppercase opacity-70 mb-1 block">Tên Học Phần (Tùy chọn)</label>
               <input 
                  type="text" 
                  value={deckTitle} 
                  onChange={(e) => setDeckTitle(e.target.value)} 
                  disabled={isProcessing}
                  className="w-full bg-white dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
                  placeholder="Để trống AI sẽ tự đặt tên theo file"
               />
            </div>
            <div>
               <label className="text-xs font-bold uppercase opacity-70 mb-1 block">Danh mục / Môn học (Tùy chọn)</label>
               <input 
                  type="text" 
                  value={deckSubject} 
                  onChange={(e) => setDeckSubject(e.target.value)} 
                  disabled={isProcessing}
                  className="w-full bg-white dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
                  placeholder="VD: Lịch sử, Toeic..."
               />
            </div>
            
            <button 
               onClick={handleConvert}
               disabled={!file || isProcessing}
               className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
            >
               {isProcessing ? (
                  <>
                     <Loader2 className="w-5 h-5 animate-spin" />
                     Đang xử lý...
                  </>
               ) : (
                  "Bắt đầu chuyển đổi AI"
               )}
            </button>
            
            {isProcessing && progress && (
               <p className="text-xs text-blue-600 dark:text-blue-400 text-center animate-pulse">{progress}</p>
            )}
         </div>
      </div>
    </section>
  );
}
