# Server Patch: Add PlaySound Support

The message types have been added to `src/models.rs`. You need to add the handler in your server implementation.

## In your server message handler (wherever you handle ClientMessage):

Add this case to handle PlaySound messages:

```rust
ClientMessage::PlaySound { sound_id, sound_name, sound_data, sound_type } => {
    // Broadcast to all connected clients
    let broadcast_message = ServerMessage::SoundPlayed {
        sound_id: sound_id.clone(),
        sound_name: sound_name.clone(),
        sound_data: sound_data.clone(),
        sound_type: sound_type.clone(),
    };
    
    // Send to all connected clients (similar to how RulerUpdate is broadcast)
    for (session_id, sender) in &clients {
        if let Err(e) = sender.send(serde_json::to_string(&broadcast_message).unwrap()) {
            tracing::warn!("Failed to send sound to {}: {}", session_id, e);
        }
    }
    
    tracing::info!("Sound '{}' broadcast to all clients", sound_name);
}
```

This should be added in the same place where other ClientMessage cases are handled (like RulerUpdate, StartCombat, etc.).

