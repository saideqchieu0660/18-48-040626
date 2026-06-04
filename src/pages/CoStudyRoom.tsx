import React, { useState, useEffect, useRef } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { store } from "../lib/store";
import { motion, AnimatePresence } from "motion/react";
import { Users, Clock, ArrowLeft, Play, Pause, RefreshCw, Award, Target } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "../lib/utils";

interface ActiveUser {
  id: string;
  name: string;
  status: "focusing" | "break";
  joinedAt: number;
  task?: string;
}

export default function CoStudyRoom() {
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [isFocusing, setIsFocusing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [mode, setMode] = useState<"focus" | "break">("focus");
  const [cycles, setCycles] = useState(0);
  const [task, setTask] = useState("");
  
  const currentUser = store.getCurrentUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (!currentUser) return;
    
    const roomRef = collection(db, "costudy_room");
    
    // Join room
    const userDocRef = doc(db, "costudy_room", currentUser.id);
    setDoc(userDocRef, {
      name: currentUser.name,
      status: mode === "focus" ? "focusing" : "break",
      joinedAt: Date.now(),
      task: task || "Đang học..."
    }).catch(console.error);

    const unsubRef = useRef<(() => void) | null>(null);
    if (unsubRef.current) unsubRef.current();

    // Listen to others
    unsubRef.current = onSnapshot(roomRef, (snapshot) => {
      const users: ActiveUser[] = [];
      snapshot.forEach(doc => {
        users.push({ id: doc.id, ...doc.data() } as ActiveUser);
      });
      setActiveUsers(users);
    });

    return () => {
      if (unsubRef.current) unsubRef.current();
      deleteDoc(userDocRef).catch(console.error);
    };
  }, [currentUser, mode]);

  // Update status/task
  useEffect(() => {
    if (!currentUser) return;
    const userDocRef = doc(db, "costudy_room", currentUser.id);
    updateDoc(userDocRef, { 
       status: mode === "focus" ? "focusing" : "break",
       task: task || "Đang học..."
    }).catch(e => console.error("Update error", e));
  }, [mode, task, currentUser]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isFocusing && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (isFocusing && timeLeft === 0) {
      setIsFocusing(false);
      if (mode === "focus") {
        setMode("break");
        setTimeLeft(5 * 60); 
        setCycles(prev => prev + 1);
      } else {
        setMode("focus");
        setTimeLeft(25 * 60);
      }
    }
    return () => clearInterval(interval);
  }, [isFocusing, timeLeft, mode]);

  const toggleTimer = () => {
    setIsFocusing(!isFocusing);
  };
  const resetTimer = () => {
    setIsFocusing(false);
    setTimeLeft(mode === "focus" ? 25 * 60 : 5 * 60);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const calculateProgress = () => {
    const total = mode === "focus" ? 25 * 60 : 5 * 60;
    return ((total - timeLeft) / total) * 100;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] p-4 md:p-8 space-y-6">
      <div className="flex justify-between items-center mb-4">
        <button 
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 opacity-60 hover:opacity-100 transition font-bold"
        >
          <ArrowLeft className="w-5 h-5" /> Trở về
        </button>
        <h2 className="text-2xl font-display font-bold text-amber-600 dark:text-amber-400 flex items-center gap-2">
          <Users className="w-6 h-6" /> Phòng Tự Học Chung (Co-Study)
        </h2>
      </div>

      <div className="grid md:grid-cols-3 gap-8 flex-1">
        <div className="md:col-span-2 glass rounded-3xl p-8 md:p-12 flex flex-col items-center justify-center relative overflow-hidden">
           <div className="w-full max-w-sm mb-8 z-10">
              <div className="flex items-center gap-2 bg-stone-200 dark:bg-zinc-900 rounded-xl p-2">
                 <Target className="w-5 h-5 text-amber-600 ml-2" />
                 <input 
                    type="text" 
                    value={task} 
                    onChange={(e) => setTask(e.target.value)}
                    placeholder="Mục tiêu tập trung..."
                    className="bg-transparent border-none focus:ring-0 w-full font-bold"
                 />
              </div>
           </div>

           <div className="z-10 flex gap-4 mb-12">
             <button 
                onClick={() => { setMode("focus"); setTimeLeft(25 * 60); setIsFocusing(false); }}
                className={cn("px-6 py-2 rounded-full font-bold transition", mode === "focus" ? "bg-amber-600 text-white" : "bg-stone-200 dark:bg-zinc-800 opacity-60 hover:opacity-100")}
             >
                Pomodoro (25p)
             </button>
             <button 
                onClick={() => { setMode("break"); setTimeLeft(5 * 60); setIsFocusing(false); }}
                className={cn("px-6 py-2 rounded-full font-bold transition", mode === "break" ? "bg-green-600 text-white" : "bg-stone-200 dark:bg-zinc-800 opacity-60 hover:opacity-100")}
             >
                Nghỉ ngơi (5p)
             </button>
          </div>

          <div className="relative group w-64 h-64 md:w-80 md:h-80 flex items-center justify-center mb-12 z-10">
             <svg className="absolute inset-0 w-full h-full -rotate-90">
               <circle cx="50%" cy="50%" r="48%" className="stroke-stone-200 dark:stroke-zinc-800 fill-none stroke-[8px]" />
               <motion.circle 
                 cx="50%" cy="50%" r="48%" 
                 className={cn("fill-none stroke-[8px] transition-all", mode === "focus" ? "stroke-amber-500" : "stroke-green-500")}
                 strokeDasharray="300%"
                 strokeDashoffset={`${300 - (calculateProgress() / 100) * 300}%`}
                 initial={{ strokeDashoffset: "300%" }}
                 animate={{ strokeDashoffset: `${300 - (calculateProgress() / 100) * 300}%` }}
               />
             </svg>
             <div className="text-6xl md:text-8xl font-mono font-bold tracking-tighter tabular-nums drop-shadow-md text-stone-800 dark:text-stone-100 flex items-center justify-center">
                 {formatTime(timeLeft)}
             </div>
          </div>

          <div className="flex items-center gap-6 z-10">
             <button 
                onClick={resetTimer}
                className="p-4 rounded-full bg-stone-200 dark:bg-zinc-800 hover:bg-stone-300 dark:hover:bg-zinc-700 transition"
             >
                <RefreshCw className="w-6 h-6" />
             </button>
             <button 
                onClick={toggleTimer}
                className={cn("p-6 rounded-full text-white shadow-xl hover:scale-105 transition", isFocusing ? "bg-red-500 hover:bg-red-600" : (mode === "focus" ? "bg-amber-600 hover:bg-amber-700" : "bg-green-600 hover:bg-green-700"))}
             >
                {isFocusing ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
             </button>
          </div>
        </div>

        <div className="glass rounded-3xl p-6 md:p-8 flex flex-col h-full">
           <h3 className="text-xl font-bold border-b border-amber-600/20 dark:border-amber-500/30 pb-4 mb-6 flex items-center justify-between">
              <span className="flex items-center gap-2"><Users className="w-5 h-5 text-amber-500" /> Hiện diện</span>
           </h3>

           <div className="flex-1 overflow-y-auto space-y-3 pr-2">
              {activeUsers.map(user => (
                 <motion.div 
                   key={user.id} 
                   initial={{ opacity: 0, x: 20 }}
                   animate={{ opacity: 1, x: 0 }}
                   className="flex items-center justify-between p-3 bg-stone-200/60 dark:bg-zinc-800/50 rounded-xl"
                 >
                    <div className="flex items-center gap-3">
                       <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-400 to-yellow-600 flex items-center justify-center text-white font-bold uppercase shadow-sm">
                          {user.name.charAt(0)}
                       </div>
                       <div>
                          <p className="font-bold text-sm">
                            {user.name} {user.id === currentUser?.id ? "(Bạn)" : ""}
                            <span className="block text-xs font-normal opacity-60">{user.task}</span>
                          </p>
                       </div>
                    </div>
                 </motion.div>
              ))}
           </div>
        </div>
      </div>
    </div>
  );
}
