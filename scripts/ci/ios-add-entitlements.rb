#!/usr/bin/env ruby
# Add the Push Notifications entitlement (aps-environment) to the iOS App target.
#
# Why: VoIP push (Twilio Voice / PushKit) AND Firebase alert push both require the
# app binary to carry the `aps-environment` entitlement. `cap add ios` generates a
# bare project on every clean CI build WITHOUT an entitlements file, so iOS could
# never register for push (PushKit's registry returns no token → Twilio's
# `registrationSuccess` never fires → no incoming calls). This adds the entitlement
# + points the App target at it. Idempotent.
#
# Requires: the App ID `ai.opiflow.app` to have the "Push Notifications" capability
# enabled in the Apple Developer portal (it is, from the Firebase APNs setup). The
# App Store distribution profile then includes it, so `aps-environment=production`
# (TestFlight + App Store use the PRODUCTION APNs environment).
#
# Run in CI (codemagic.yaml ios-release) after `cap add ios`, alongside
# ios-register-plist.rb. Requires the `xcodeproj` gem.

require "xcodeproj"

project_path = "ios/App/App.xcodeproj"
ent_rel = "App/App.entitlements"        # relative to the App target's SRCROOT (ios/App)
ent_path = "ios/App/#{ent_rel}"

ent_xml = <<~XML
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
  \t<key>aps-environment</key>
  \t<string>production</string>
  </dict>
  </plist>
XML

File.write(ent_path, ent_xml)
puts "wrote #{ent_path} (aps-environment=production)"

project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |t| t.name == "App" }
abort "ERROR: 'App' target not found in #{project_path}" unless target

unless project.files.any? { |f| f.path && f.path.end_with?("App.entitlements") }
  app_group = project.main_group.find_subpath("App", true)
  app_group.new_reference("App.entitlements")
  puts "added App.entitlements file reference"
end

target.build_configurations.each do |config|
  config.build_settings["CODE_SIGN_ENTITLEMENTS"] = ent_rel
end
project.save
puts "CODE_SIGN_ENTITLEMENTS = #{ent_rel} on the App target (all configs)"
