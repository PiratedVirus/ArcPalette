//
//  SafariWebExtensionHandler.swift
//  Arc Palette Extension
//
//  Created by Saurabh Kulkarni on 02/10/26.
//

import SafariServices
import os.log

/// Handles `browser.runtime.sendNativeMessage` calls from background.js.
/// Used for things web extensions can't do themselves, like placing Safari windows.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]

        // NSAppleScript must run on the main thread.
        DispatchQueue.main.async {
            let reply: [String: Any]
            switch message["action"] as? String {
            case "tile":
                reply = Self.tileWindows(message)
            default:
                reply = ["ok": false, "error": "Unknown action"]
            }
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: reply]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }

    /// Puts the front Safari window on the right half of `frame` and the window
    /// showing `leftURL` on the left half — the "split view" layout.
    private static func tileWindows(_ message: [String: Any]) -> [String: Any] {
        guard
            let frame = message["frame"] as? [String: Any],
            let x = (frame["x"] as? NSNumber)?.intValue,
            let y = (frame["y"] as? NSNumber)?.intValue,
            let width = (frame["width"] as? NSNumber)?.intValue,
            let height = (frame["height"] as? NSNumber)?.intValue,
            width > 0, height > 0
        else {
            return ["ok": false, "error": "Missing screen frame"]
        }
        let gap = (message["gap"] as? NSNumber)?.intValue ?? 8
        let leftURL = (message["leftURL"] as? String ?? "")
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")

        let mid = x + width / 2
        let bottom = y + height
        let leftBounds = "{\(x), \(y), \(mid - gap / 2), \(bottom)}"
        let rightBounds = "{\(mid + (gap - gap / 2)), \(y), \(x + width), \(bottom)}"

        let source = """
        tell application "Safari"
            if (count of windows) < 2 then error "Split view needs two windows." number 1001
            set rightWin to front window
            set rightId to id of rightWin
            set leftWin to missing value
            repeat with w in windows
                set w to contents of w
                if id of w is not rightId then
                    try
                        if URL of current tab of w is "\(leftURL)" then
                            set leftWin to w
                            exit repeat
                        end if
                    end try
                end if
            end repeat
            if leftWin is missing value then set leftWin to window 2
            set bounds of leftWin to \(leftBounds)
            set bounds of rightWin to \(rightBounds)
            set index of leftWin to 1
        end tell
        """

        var error: NSDictionary?
        NSAppleScript(source: source)?.executeAndReturnError(&error)
        if let error {
            let code = (error[NSAppleScript.errorNumber] as? NSNumber)?.intValue ?? 0
            let text = error[NSAppleScript.errorMessage] as? String ?? "AppleScript failed"
            os_log(.error, "Arc Palette tile failed (%d): %@", code, text)
            // -1743: the user hasn't allowed Arc Palette to control Safari.
            return ["ok": false, "code": code, "error": text]
        }
        return ["ok": true]
    }
}
