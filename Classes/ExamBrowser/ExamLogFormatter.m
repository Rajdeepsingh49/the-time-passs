//
//  ExamLogFormatter.m
//  Safe Exam Browser
//

#import "ExamLogFormatter.h"

// Lines are formatted on the logger's queue, some time after they were logged. So the phase a line belongs to is
// decided by when the line was logged (its timestamp) against when the phase changed, never by when it is formatted.
static NSMutableArray<NSArray *> *phaseChanges;    // @[ NSDate, @(phase) ], oldest first
static NSMutableArray<NSArray *> *muteIntervals;   // @[ start NSDate, end NSDate, @(phase it was set in) ]
static NSLock *phaseLock;

@implementation ExamLogFormatter

+ (void)initialize
{
    if (self == [ExamLogFormatter class]) {
        phaseLock = [NSLock new];
        muteIntervals = [NSMutableArray new];
        phaseChanges = [NSMutableArray arrayWithObject:@[[NSDate dateWithTimeIntervalSince1970:0], @(ExamLogPhaseStartup)]];
    }
}


+ (void)setPhase:(ExamLogPhase)phase
{
    [phaseLock lock];
    [phaseChanges addObject:@[[NSDate date], @(phase)]];
    [phaseLock unlock];
}


+ (ExamLogPhase)phase
{
    [phaseLock lock];
    ExamLogPhase phase = (ExamLogPhase)[phaseChanges.lastObject[1] integerValue];
    [phaseLock unlock];
    return phase;
}


// Everything logged from now until the given number of seconds later is dropped (except the
// list of running applications). Used around the exam lock: whatever toggling it sets off inside SEB is never logged.
+ (void)muteFor:(NSTimeInterval)seconds
{
    NSDate *now = [NSDate date];
    ExamLogPhase phase = [self phaseAtDate:now];
    [phaseLock lock];
    [muteIntervals addObject:@[now, [now dateByAddingTimeInterval:seconds], @(phase)]];
    [phaseLock unlock];
}


// Muted only within the phase it was set in: locking while the exam runs must never swallow the lines of the quit
+ (BOOL)isMutedAtDate:(NSDate *)date phase:(ExamLogPhase)phase
{
    BOOL muted = NO;
    [phaseLock lock];
    for (NSArray *interval in muteIntervals) {
        if ([interval[0] compare:date] != NSOrderedDescending && [interval[1] compare:date] == NSOrderedDescending
            && [interval[2] integerValue] == phase) {
            muted = YES;
            break;
        }
    }
    [phaseLock unlock];
    return muted;
}


// The phase that was current when a line was logged
+ (ExamLogPhase)phaseAtDate:(NSDate *)date
{
    ExamLogPhase phase = ExamLogPhaseStartup;
    [phaseLock lock];
    for (NSArray *change in phaseChanges) {
        if ([change[0] compare:date] == NSOrderedDescending) {
            break;
        }
        phase = (ExamLogPhase)[change[1] integerValue];
    }
    [phaseLock unlock];
    return phase;
}


// Lines that are never written, in any phase: they would show what the student does during the exam.
//   ://                         any web or file address (pages the student opens)
//   Title of current Page       the title of a page
//   clipboard / pasteboard      copying and pasting
//   download                    names of downloaded files
//   Started application, launched app, Activated app     applications the student starts or switches to
//   Switched back to SEB, Regain active, isActive property, App which switched Space     focus and window switching
//   Notification: NSWorkspace...   the system telling SEB that an application started, was activated or the Space changed
//   terminated by SEB during this session: <entries>, Trying to restart terminated process     the applications SEB had
//                               to end when quitting (only with exam settings that forbid applications)
// Everything else the original writes stays exactly as the original wrote it.
+ (NSRegularExpression *)neverLoggedPattern
{
    static NSRegularExpression *pattern;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        pattern = [NSRegularExpression regularExpressionWithPattern:
                   @"://|Title of current Page|clipboard|pasteboard|download"
                   @"|Started application|launched app|Activated app|Switched back to SEB|Regain active|isActive property|App which switched Space"
                   @"|Notification: +NSWorkspace"
                   @"|Trying to restart terminated process|terminated by SEB during this session:[^\\n]*\\n +[^ \\n)]"
                                                            options:NSRegularExpressionCaseInsensitive
                                                              error:nil];
    });
    return pattern;
}


// Lines that are also dropped while the exam runs. Before the exam starts and after it ends they are written as the
// original writes them (the applications that happen to be open when SEB starts); during the exam each of them is
// something the student did. Found by going through every log statement of the original that can fire while a
// session runs.
//   other applications and processes     which application opened a window or was found, checked, terminated, started
//   focus, keys, sessions                SEB's window becoming or resigning key, the active window, Tab, user switching
//   Dock and links                       starting an application from SEB's Dock, opening new windows/tabs, reloading,
//                                        links the URL filter blocked, file upload, TLS challenges naming a host,
//                                        cookie dumps, a page opening a window with JavaScript, dictionary look-ups
//   kiosk, window levels, screens        what the exam lock (Cmd+Shift+L) drives inside SEB: switching the kiosk mode,
//                                        window levels, covering windows, screen set-up. Dropped by what they say, so the
//                                        lock leaves no trace even in a line that arrives after the lock's mute is over.
//   bundle ID / localized name / executable URL     any other line that identifies an application
+ (NSRegularExpression *)runningMaskedPattern
{
    static NSRegularExpression *pattern;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        pattern = [NSRegularExpression regularExpressionWithPattern:
                   @"has opened a window with level|don'?t terminate application|is being force terminated|signed system executable"
                   @"|Control/Notification Center was opened|owns menu bar|Active window:|Window list:|Window .+ is on space"
                   @"|NSRunningApplication|owning process|PID: .+ - (Name|Bundle ID)|process with PID|True Parent PID"
                   @"|Running process .+ did terminate|prohibited process|Terminating .+ was|terminate[d]? app(lication)?|force terminat"
                   @"|terminated by SEB during this session|restart terminated process|Application .+ was terminated"
                   @"|SEB got active|did (become|resign) (key|main)|Current key window|Tab key pressed|Option \\+ .*Tab"
                   @"|SessionDid(Resign|Become)Active|User switch|switched the Space"
                   @"|Dock button pressed|Application with Bundle ID|Activating application|Manually starting application"
                   @"|Open new window/tab|Opening new window/tab|link was blocked|blocked by the (URL|content) filter"
                   @"|Reload(ing)? (Current Page|current webpage)|File to upload|Open and Save Panels|Attempted .+ is not allowed"
                   @"|didReceiveChallenge|cookies( after transfer)?:|Javascript \\.open|Dictionary look-up"
                   @"|font used on the current webpage|most likely opened dialog"
                   @"|switchKioskMode|startKioskMode|changeWindowLevels|browserWindowsChangeLevel|setLevelForBrowserWindow"
                   @"|setElevateWindowLevels|adjustModalAlertWindowLevels|setPresentationOptions|reinforc[A-Za-z ]*kiosk"
                   @"|coverScreens|closeCoveringWindows|covering window|Cap window|background windows|Screen is (in)?active"
                   @"|Flagged screen|Adjusting (screen|lockdown)|will move|did move|windowDidChangeScreen|Adjusted window frame"
                   @"|inactive screen|move window back|Moved browser window back"
                   @"|bundle ?ID|localized ?name|executable ?URL"
                                                            options:NSRegularExpressionCaseInsensitive
                                                              error:nil];
    });
    return pattern;
}


// The two lists of the applications that were running when SEB started ("  Name (bundle ID: x)" and
// "Name, bundle ID: x"). They always stay: an application called "1Password" or "Wi-Fi Explorer" is still listed.
+ (NSRegularExpression *)runningApplicationLinePattern
{
    static NSRegularExpression *pattern;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        pattern = [NSRegularExpression regularExpressionWithPattern:@"^(?: {2}[^\\n]+ \\(bundle ID: [^\\n]*\\)|[^:\\n]+, bundle ID: [^\\n]*)$"
                                                            options:0 error:nil];
    });
    return pattern;
}


// The original's marker lines ("---------- EXITING SEB - ENDING SESSION -------------"): the start and end of a session
// with their times. Nothing the lock sets off writes one.
+ (NSRegularExpression *)markerLinePattern
{
    static NSRegularExpression *pattern;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        pattern = [NSRegularExpression regularExpressionWithPattern:@"^---------- [^\\n]+ -------------$" options:0 error:nil];
    });
    return pattern;
}


+ (BOOL)allowsMessage:(NSString *)message phase:(ExamLogPhase)phase muted:(BOOL)muted
{
#ifdef DEBUG
    // Debug builds only: the complete, unfiltered original log, for comparing against
    if (getenv("SEB_UNFILTERED_LOG") != NULL) {
        return YES;
    }
#endif
    if (message.length == 0) {
        return NO;
    }
    BOOL running = (phase == ExamLogPhaseRunning);
    NSRange all = NSMakeRange(0, message.length);
    // The lists of applications that were running when SEB started are written as the original writes them
    if (!running && [[self runningApplicationLinePattern] numberOfMatchesInString:message options:0 range:all] > 0) {
        return YES;
    }
    BOOL marker = [[self markerLinePattern] numberOfMatchesInString:message options:0 range:all] > 0;
    if (muted && !marker) {
        return NO;
    }
    if ([[self neverLoggedPattern] numberOfMatchesInString:message options:0 range:all] > 0) {
        return NO;
    }
    // While the exam runs everything else the original writes is written, except what shows what the student does
    return !(running && [[self runningMaskedPattern] numberOfMatchesInString:message options:0 range:all] > 0);
}


- (NSString *)formatLogMessage:(DDLogMessage *)logMessage
{
    ExamLogPhase phase = [ExamLogFormatter phaseAtDate:logMessage.timestamp];
    BOOL muted = [ExamLogFormatter isMutedAtDate:logMessage.timestamp phase:phase];
    if (![ExamLogFormatter allowsMessage:logMessage.message phase:phase muted:muted]) {
        return nil;
    }
    // The line itself is exactly what the original writes
    return [super formatLogMessage:logMessage];
}

@end
