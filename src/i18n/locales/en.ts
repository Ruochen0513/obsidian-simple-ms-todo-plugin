/**
 * English locale — the source of truth for translation keys.
 *
 * Wording intentionally restores the original author's UX (from upstream
 * repo). New features added since the fork get natural English in the same
 * plain style.
 */

type DotJoin<T, P extends string = ''> = {
    [K in keyof T & string]:
        T[K] extends string
            ? P extends '' ? K : `${P}.${K}`
            : DotJoin<T[K], P extends '' ? K : `${P}.${K}`>
}[keyof T & string];

export const en = {
    common: {
        cancel: 'Cancel',
        add: 'Add',
        create: 'Create',
        delete: 'Delete',
        signIn: 'Sign in',
        signOut: 'Sign out',
        tasks: 'Tasks',
        refresh: 'Refresh',
        more: 'More',
    },

    commands: {
        openView: 'Open Microsoft To Do sidebar',
        quickCapture: 'Quick capture: add a task',
        syncToMarkdown: 'Sync Microsoft To Do to markdown',
    },

    settings: {
        accountStatus: 'Account status',
        signedIn: '✅ Signed in',
        notSignedIn: '❌ Not signed in',
        markdownSync: 'Markdown sync',
        markdownSyncDesc: 'Generate a one-way Markdown file for all lists. When disabled, the file is no longer created or updated.',
        markdownSyncFile: 'Markdown sync file',
        markdownSyncFileDesc: 'File path. Click the input to see folder suggestions; selecting one appends the current file name. The target folder is created automatically on sync.',
        syncAfterLogin: 'Sync after login',
        syncAfterLoginDesc: 'Create or update the markdown file after a successful sign in.',
        syncOnStartup: 'Sync on startup',
        syncOnStartupDesc: 'Refresh the markdown file shortly after Obsidian starts.',
        manualSync: 'Manual markdown sync',
        manualSyncDesc: 'Fetch all Microsoft To Do lists and write them into the markdown file now.',
        syncNow: 'Sync now',
        language: 'Language',
        languageDesc: 'Choose the plugin UI language. Defaults to following Obsidian.',
        languageAuto: 'Follow Obsidian',
        languageEn: 'English',
        languageZhCn: '简体中文',
    },

    notices: {
        loadingMsTodo: 'Loading Microsoft To Do...',
        loadFailed: 'Error',
        loadViewFailed: 'Failed to load view',
        authorizationRefused: 'Authorization refused',
        connecting: 'Connecting to Microsoft To Do...',
        connected: 'Microsoft To Do connected',
        tokenFailed: 'Failed to get token. Check the console.',
        signInRequired: 'Sign in to Microsoft To Do first',
        signInRequiredForQuickCapture: 'Sign in to Microsoft To Do first (open the sidebar to sign in)',
        loadListsFailed: 'Failed to load lists',
        markdownSyncDisabled: 'Markdown sync is disabled. Enable it in plugin settings.',
        syncCompleted: 'Synced {taskCount} tasks from {listCount} lists to {path}',
        syncFailed: 'Failed to sync Microsoft To Do to markdown',
        listCreated: 'List created',
        createListFailed: 'Failed to create list',
        listDeleted: 'List deleted',
        deleteListFailed: 'Failed to delete list',
        taskCreatedDueTodayFailed: 'Task created, but setting it to today failed. Find it in the "Tasks" list.',
        addTodayTaskFailed: "Failed to add today's task",
        addTaskFailedRestored: 'Failed to add task; your input has been restored',
        updateTaskFailedReverted: 'Failed to update task; changes reverted',
        loadCompletedFailed: 'Failed to load completed tasks',
        taskDeleted: 'Task deleted',
        deleteTaskFailedReverted: 'Failed to delete task; changes reverted',
        updateTaskFailed: 'Failed to update task',
        taskAddedTo: 'Added to "{listName}"',
        taskAddedDueTodaySuffix: ', due today',
        addTaskFailed: 'Failed to add task',
    },

    sidebar: {
        searchTasks: 'Search tasks',
        currentViewAria: 'Current view: {viewName}',
        currentListAria: 'Current list: {listName}',
        switchViewAria: 'Switch view or list',
        smartViews: 'Smart views',
        lists: 'Lists',
        newList: 'Create list',
        syncToNote: 'Sync to note',
        deleteCurrentList: 'Delete current list',
        loadingListAria: 'Loading list',
    },

    smartView: {
        myDay: 'My Day',
        overdue: 'Overdue',
        overdueCountAria: 'overdue tasks',
    },

    search: {
        placeholder: 'Search all tasks…',
        ariaLabel: 'Search all tasks',
        clearAria: 'Clear search',
        emptyTitle: 'No matching tasks found',
        emptySubtitle: 'Try a different keyword.',
    },

    empty: {
        myDayTitle: 'No tasks due today',
        myDaySubtitle: 'You can add a task to complete today below.',
        overdueTitle: 'No overdue tasks',
        overdueSubtitle: 'Everything is on track. Keep it up.',
        defaultTitle: 'Nothing to do 🎉',
        defaultSubtitle: 'Add a new to-do below.',
        noListsTitle: 'Create your first list',
        noListsSubtitle: 'No lists available in Microsoft To Do yet.',
    },

    signedOut: {
        subtitle: 'Sign in to view lists, edit notes, set due dates, and sync tasks to Obsidian notes.',
        signInButton: 'Sign in Microsoft To Do',
    },

    taskRow: {
        completeAria: 'Complete task',
        reopenAria: 'Reopen task',
        syncingAria: 'Syncing',
        completedHeading: 'Completed',
        completedLoading: 'Loading completed tasks in background…',
        completedEmpty: 'No completed tasks',
    },

    taskDetail: {
        backAria: 'Back to tasks',
        title: 'Task details',
        titleUpdated: 'Title updated',
        removeImportantAria: 'Remove important',
        markImportantAria: 'Mark as important',
        removedFromImportant: 'Removed from important',
        markedAsImportant: 'Marked as important',
        stepsLabel: 'Steps',
        reopenStepAria: 'Reopen step: {stepName}',
        completeStepAria: 'Complete step: {stepName}',
        deleteStepAria: 'Delete step: {stepName}',
        updateStepFailed: 'Failed to update step',
        deleteStepFailed: 'Failed to delete step',
        addStepFailed: 'Failed to add step',
        addStepPlaceholder: 'Add step',
        addTodayPlaceholder: "Add today's task",
        addTodayAria: "Add today's task to {listName}",
        addTaskPlaceholder: 'Add a task',
        addTaskAria: 'Add task to {listName}',
        dueDateLabel: 'Due date',
        dueDateUpdated: 'Due date updated',
        dueDateCleared: 'Due date cleared',
        clearDate: 'Clear due date',
        chipToday: 'Today',
        chipTomorrow: 'Tomorrow',
        chipNextWeek: 'Next week',
        setDueDateAria: 'Set due date to {label}',
        dueDateSetTo: 'Due date set to {label}',
        notesLabel: 'Notes',
        notePlaceholder: 'Add notes',
        saveNote: 'Save note',
        noteUpdated: 'Note updated',
        createdAt: 'Created {date}',
        completedAt: 'Completed {date}',
        deleteTaskAria: 'Delete task: {taskTitle}',
        deleteTask: 'Delete task',
    },

    modal: {
        deleteListTitle: 'Delete list?',
        deleteListBefore: 'Delete list "',
        deleteListAfter: '" and all its tasks. This cannot be undone.',
        deleteTaskTitle: 'Delete task?',
        deleteTaskBefore: 'Delete "',
        deleteTaskAfter: '"? This cannot be undone.',
        createListPlaceholder: 'Enter list name',
        quickCaptureTitle: 'Quick capture',
        quickCapturePlaceholder: 'What do you want to capture?',
        quickCaptureTargetList: 'Target list',
        quickCaptureDueToday: 'Due today',
        quickCaptureAdding: 'Adding…',
    },

    markdownBlock: {
        syncTimestamp: '> Synced at {date}. Edit tasks in Microsoft To Do, then sync again.',
        noTasks: '_No tasks._',
        linkedResource: 'Linked resource',
        important: '🔴 high',
        duePrefix: 'due: {date}',
        reminderPrefix: 'reminder: {date}',
        metadataOpen: '(',
        metadataClose: ')',
        metadataJoiner: ', ',
        resourceUrlSeparator: ':',
    },

    apiError: {
        noSignInInfo: 'No sign-in information found',
        signInExpired: 'Sign in expired. Please sign in again.',
        tokenRefreshing: 'Token is expiring, refreshing...',
    },

    date: {
        today: 'Today',
        tomorrow: 'Tomorrow',
        completed: 'Completed',
        overdueWithDate: 'Overdue · {date}',
        shortFormat: '{month}/{day}',
        fullFormat: '{m}/{d}/{y}',
    },
} as const;

export type TranslationKey = DotJoin<typeof en>;
