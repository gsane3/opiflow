#!/usr/bin/env ruby
# Register GoogleService-Info.plist into the App target's "Copy Bundle Resources"
# so Firebase can read it at runtime (otherwise FirebaseApp auto-init fails and no
# FCM token is produced on iOS). Merely placing the file on disk is NOT enough —
# it must be referenced in the Xcode project.
#
# Idempotent. Run in CI (codemagic.yaml ios-release) after `cap add ios` and after
# the plist has been written to ios/App/App/GoogleService-Info.plist.
#
# Requires the `xcodeproj` gem (CI does `gem install xcodeproj`).

require "xcodeproj"

project_path = "ios/App/App.xcodeproj"
plist_name = "GoogleService-Info.plist"

unless File.exist?("ios/App/App/#{plist_name}")
  warn "WARNING: ios/App/App/#{plist_name} not found on disk — skipping registration"
  exit 0
end

project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |t| t.name == "App" }
abort "ERROR: 'App' target not found in #{project_path}" unless target

already = project.files.any? { |f| f.path && f.path.end_with?(plist_name) }
if already
  puts "#{plist_name} already referenced in the project — skipping"
  exit 0
end

app_group = project.main_group.find_subpath("App", true)
ref = app_group.new_reference(plist_name) # path relative to ios/App/App
target.add_resources([ref])
project.save
puts "#{plist_name} registered in the App target's resources"
