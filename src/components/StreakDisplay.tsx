import { useState } from "react";
import { Flame } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { store } from "../lib/store";

// Mock study data for the last 7 days
const data = [
  { day: 'T2', count: 20 },
  { day: 'T3', count: 35 },
  { day: 'T4', count: 18 },
  { day: 'T5', count: 45 },
  { day: 'T6', count: 30 },
  { day: 'T7', count: 50 },
  { day: 'CN', count: 40 },
];

export function StreakDisplay() {
  const [showChart, setShowChart] = useState(false);
  const user = store.getCurrentUser();
  if (!user || user.streak === undefined) return null;

  return (
    <div className="relative" onMouseEnter={() => setShowChart(true)} onMouseLeave={() => setShowChart(false)}>
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-600 dark:text-orange-400 font-bold text-sm cursor-help transition-all hover:bg-orange-500/20">
        <Flame className="w-4 h-4 fill-current animate-pulse" />
        <span>{user.streak}</span>
      </div>
      
      {showChart && (
        <div className="absolute top-10 right-0 w-64 h-48 bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-2xl shadow-xl p-4 z-50 animate-in fade-in zoom-in duration-200">
          <h4 className="text-xs font-semibold mb-3 text-stone-600 dark:text-stone-400 uppercase tracking-wider">Hoạt động 7 ngày qua</h4>
          <ResponsiveContainer width="100%" height="75%">
             <BarChart data={data}>
                <XAxis dataKey="day" tick={{fontSize: 10}} tickLine={false} axisLine={false} />
                <Tooltip 
                    cursor={{fill: 'transparent'}}
                    contentStyle={{borderRadius: '8px', border: 'none', background: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: '12px'}}
                    itemStyle={{color: '#fff'}}
                />
                <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
             </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
