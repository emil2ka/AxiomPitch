import AppKit

// Electron's workArea follows menu-bar settings. Read the physical camera
// housing from AppKit instead, including when the menu bar is hidden.
let screens = NSScreen.screens
let primaryTop = screens.first?.frame.maxY ?? 0
let result = screens.map { screen -> [String: Any] in
    let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 0
    let top = screen.safeAreaInsets.top
    var center = screen.frame.midX
    if top > 0, let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
        center = (left.maxX + right.minX) / 2
    }
    return ["id": id, "safeTop": top, "center": center,
            "y": primaryTop - screen.frame.maxY]
}
if let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) {
    print(json)
}
