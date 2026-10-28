//
//  ExamLogFormatter.h
//  Safe Exam Browser
//
//  SEB writes its log through the original DDFileLogger (same folder, same file names, same
//  "yyyy/MM/dd HH:mm:ss:SSS  message" lines, same wording, same rolling and limit of 20 files). This
//  formatter sits in front of it and changes only WHICH lines get written, never how a line looks:
//
//    startup   everything the original writes while SEB starts up and a session begins stays: the
//              banner, the system information, the settings lines, the list of the applications that
//              were running in the background, and so on ...
//    running   ... while the exam runs, the original keeps writing what it writes (WiFi status, the quit
//              sequence, errors, ...) except what shows what the student does: no application that starts,
//              opens a window or is switched to, no page, title or address, no clipboard, no window, tab
//              or space switching, no downloads, nothing about the exam lock.
//    ending    everything the original writes while SEB quits or the session restarts stays,
//              including its end marker.
//
//  SEB adds no line of its own. The exam's start is the original's "INITIALIZING SEB - STARTING SESSION" line
//  and its end is the original's "EXITING SEB - ENDING SESSION" line, each with its own time.
//
//  Whatever the phase, lines that would show what the student does (pages, copy and paste, downloads, applications
//  started or switched to, window switching) are dropped, see +allowsMessage:.... While the exam runs a few more
//  kinds of lines are dropped, see +runningMaskedPattern. A line that is written is exactly the original's line,
//  character for character. The exam's own settings decide, as in the original, whether there is a log and at
//  which level.
//

#if __has_feature(modules)
@import CocoaLumberjack;
#else
#import <CocoaLumberjack/CocoaLumberjack.h>
#endif

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, ExamLogPhase) {
    ExamLogPhaseStartup = 0,
    ExamLogPhaseRunning = 1,
    ExamLogPhaseEnding = 2
};

@interface ExamLogFormatter : DDLogFileFormatterDefault

+ (void)setPhase:(ExamLogPhase)phase;
+ (ExamLogPhase)phase;

/// The rules, separately from the logger so they can be tested
+ (BOOL)allowsMessage:(NSString *)message phase:(ExamLogPhase)phase muted:(BOOL)muted;

/// Drops everything logged during the next `seconds` (the running-applications list excepted).
/// Called whenever the exam lock is toggled, so nothing that toggling sets off inside SEB can be in the log.
+ (void)muteFor:(NSTimeInterval)seconds;

@end

NS_ASSUME_NONNULL_END
