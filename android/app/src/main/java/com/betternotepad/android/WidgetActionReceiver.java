package com.betternotepad.android;

import android.content.Context;
import android.content.Intent;

// Only app-created PendingIntents can enter this non-exported receiver.
public class WidgetActionReceiver extends NoteWidgetProvider {
    @Override public void onReceive(Context context, Intent intent) { receiveAction(context, intent); }
}
