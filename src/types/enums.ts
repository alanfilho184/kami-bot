enum Ban_Type {
    TEMPORARY = 'TEMPORARY',
    PERMANENT = 'PERMANENT',
    UNBANNED = 'UNBANNED'
}

enum Available_Languages {
    'pt-br' = 'pt-br',
    'en-us' = 'en-us'
}

enum Section_Type {
    STANDARD = 0,
    DESCRIPTION = 1,
    HEADER = 2,
    STATUS = 3,
    GALLERY = 4,
    TABLE = 5
}

enum Attribute_Type {
    TEXT = 0,
    NUMBER = 1,
    IMAGE = 2,
    LIST = 3,
    BAR = 4,
    STATUS = 5,
    TABLE = 6
}

enum Macro_Type {
    NORMAL = 0,
    MODIFIER_PLUS = 1,
    MODIFIER_MINUS = 2
}

enum Announcement_Mode {
    ALWAYS = 'ALWAYS',
    ONCE = 'ONCE',
    INTERVAL = 'INTERVAL'
}

enum Command_Category {
    GENERAL = 'GENERAL',
    INSANITY = 'INSANITY',
    ROLL = 'ROLL',
    SHEET_ALTER = 'SHEET_ALTER',
    SHEET_SEND = 'SHEET_SEND',
    OWNER_ONLY = 'OWNER_ONLY'
}

export { Ban_Type, Available_Languages, Section_Type, Attribute_Type, Macro_Type, Command_Category, Announcement_Mode };
