"use client";

import * as React from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { cn } from "@/lib/utils";

interface ClickUpCalendarProps {
  selectedDate: Date | null;
  onSelect: (date: Date | null) => void;
  onClose: () => void;
}

export function ClickUpCalendar({ selectedDate, onSelect, onClose }: ClickUpCalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState<Date>(() => selectedDate || new Date());

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth((prev) => subMonths(prev, 1));
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth((next) => addMonths(next, 1));
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: startDate, end: endDate });

  return (
    <div
      className="p-3 w-[260px] select-none bg-white rounded-2xl shadow-xl border border-gray-100 flex flex-col gap-3 text-sm animate-in fade-in-50 zoom-in-95 duration-200"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={handlePrevMonth}
          className="p-1 rounded-lg hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
        >
          <CaretLeftIcon className="size-4" weight="bold" />
        </button>
        <span className="font-semibold text-gray-800">{format(currentMonth, "MMMM yyyy")}</span>
        <button
          onClick={handleNextMonth}
          className="p-1 rounded-lg hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
        >
          <CaretRightIcon className="size-4" weight="bold" />
        </button>
      </div>

      {/* Weekdays Header */}
      <div className="grid grid-cols-7 text-center text-xs font-semibold text-gray-400">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {days.map((day) => {
          const isCurrentM = isSameMonth(day, currentMonth);
          const isSel = selectedDate ? isSameDay(day, selectedDate) : false;
          const isTod = isToday(day);

          return (
            <button
              key={day.toString()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(day);
                onClose();
              }}
              className={cn(
                "h-7 w-7 mx-auto rounded-full flex items-center justify-center text-xs transition-all relative font-medium cursor-pointer",
                !isCurrentM && "text-gray-300",
                isCurrentM && "text-gray-700 hover:bg-gray-50",
                isTod && "border border-primary text-primary font-bold",
                isSel && "bg-primary text-white hover:bg-primary/95",
              )}
            >
              {format(day, "d")}
              {isTod && !isSel && <span className="absolute bottom-1 size-1 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>

      {/* Footer shortcuts */}
      <div className="h-px bg-gray-100 my-1" />
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(new Date()); onClose(); }}
            className="px-2 py-1 bg-gray-50 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Today
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(addDays(new Date(), 1)); onClose(); }}
            className="px-2 py-1 bg-gray-50 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Tomorrow
          </button>
        </div>
        {selectedDate && (
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(null); onClose(); }}
            className="w-full py-1 text-red-500 hover:bg-red-50 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Clear Date
          </button>
        )}
      </div>
    </div>
  );
}
