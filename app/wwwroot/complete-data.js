/* BlueScreen: dados do autocompletar embutido (complete.js), por linguagem. Compacto de propósito.
   kw: palavras-chave · stmt: as que começam um comando (sobem no começo da linha) · types: tipos primitivos
   lit: tipo dos literais { s: texto, l: lista, d: dicionário } · sep: separadores de membro
   T: tabelas de tipos/módulos. Cada entrada: "[+]nome[(parâmetros)][:Retorno]" separadas por "|"; "+" = estático
      (ou de módulo). Tabela com nome "@x" é módulo/namespace: tudo nela é acessado como x.nome
   ext: herança/apelido de tipos (ArrayList -> List) · g: funções e nomes globais (mesmo formato)
   tpl: live templates [atalho, corpo (snippet), descrição] · pfx: postfix [atalho, corpo com EXPR, descrição] */
(function () {
const JAVA_STR = 'length():int|charAt(int index):char|isEmpty():boolean|isBlank():boolean|substring(int beginIndex, int endIndex):String|indexOf(String str):int|lastIndexOf(String str):int|contains(CharSequence s):boolean|startsWith(String prefix):boolean|endsWith(String suffix):boolean|equals(Object other):boolean|equalsIgnoreCase(String other):boolean|compareTo(String other):int|trim():String|strip():String|toUpperCase():String|toLowerCase():String|replace(CharSequence target, CharSequence replacement):String|replaceAll(String regex, String replacement):String|split(String regex):String[]|toCharArray():char[]|chars():IntStream|lines():Stream<String>|repeat(int count):String|matches(String regex):boolean|concat(String str):String|formatted(Object... args):String|hashCode():int|intern():String|+format(String format, Object... args):String|+valueOf(Object obj):String|+join(CharSequence delimiter, Iterable elements):String';
const COLL = 'size():int|isEmpty():boolean|contains(Object o):boolean|add(E e):boolean|remove(Object o):boolean|addAll(Collection c):boolean|removeAll(Collection c):boolean|retainAll(Collection c):boolean|clear():void|stream():Stream<E>|iterator():Iterator<E>|forEach(Consumer action):void|removeIf(Predicate filter):boolean|toArray():Object[]';
const D = {};

D.java = {
  kw: 'abstract assert boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws transient try var void volatile while record yield sealed permits true false null',
  stmt: 'if for while do switch return try throw break continue var final new',
  types: 'int long double float boolean char byte short void var',
  lit: { s: 'String' }, sep: ['.'], newKw: true,
  ext: { ArrayList: 'List', LinkedList: 'List', CopyOnWriteArrayList: 'List', HashMap: 'Map', TreeMap: 'Map', LinkedHashMap: 'Map', ConcurrentHashMap: 'Map', HashSet: 'Set', TreeSet: 'Set', LinkedHashSet: 'Set', List: 'Collection', Set: 'Collection', Queue: 'Collection', Deque: 'Queue', ArrayDeque: 'Deque', Collection: 'Object', Integer: 'Number', Long: 'Number', Double: 'Number', RuntimeException: 'Exception', IllegalArgumentException: 'RuntimeException', IllegalStateException: 'RuntimeException', NullPointerException: 'RuntimeException', IOException: 'Exception', Exception: 'Throwable', CharSequence: 'Object', StringBuffer: 'StringBuilder', PrintWriter: 'PrintStream' },
  T: {
    Object: 'equals(Object obj):boolean|hashCode():int|toString():String|getClass():Class',
    System: '+out:PrintStream|+err:PrintStream|+in:InputStream|+currentTimeMillis():long|+nanoTime():long|+getProperty(String key):String|+getenv(String name):String|+exit(int status):void|+arraycopy(Object src, int srcPos, Object dest, int destPos, int length):void|+lineSeparator():String|+identityHashCode(Object x):int|+gc():void',
    PrintStream: 'println(Object x):void|print(Object x):void|printf(String format, Object... args):PrintStream|format(String format, Object... args):PrintStream|flush():void|close():void|write(int b):void',
    InputStream: 'read():int|readAllBytes():byte[]|available():int|close():void',
    String: JAVA_STR,
    StringBuilder: 'append(Object obj):StringBuilder|insert(int offset, Object obj):StringBuilder|toString():String|length():int|charAt(int index):char|reverse():StringBuilder|setLength(int newLength):void|deleteCharAt(int index):StringBuilder|delete(int start, int end):StringBuilder|indexOf(String str):int|replace(int start, int end, String str):StringBuilder|isEmpty():boolean',
    Math: '+abs(double a):double|+max(double a, double b):double|+min(double a, double b):double|+pow(double a, double b):double|+sqrt(double a):double|+round(double a):long|+floor(double a):double|+ceil(double a):double|+random():double|+PI:double|+E:double|+floorDiv(int x, int y):int|+floorMod(int x, int y):int|+log(double a):double|+log10(double a):double|+sin(double a):double|+cos(double a):double|+tan(double a):double|+hypot(double x, double y):double|+signum(double d):double|+clamp(long value, int min, int max):int',
    Collection: COLL,
    List: 'get(int index):E|set(int index, E element):E|add(int index, E element):void|remove(int index):E|indexOf(Object o):int|lastIndexOf(Object o):int|subList(int fromIndex, int toIndex):List<E>|sort(Comparator c):void|replaceAll(UnaryOperator op):void|getFirst():E|getLast():E|reversed():List<E>|+of(E... elements):List<E>|+copyOf(Collection c):List<E>',
    Set: '+of(E... elements):Set<E>|+copyOf(Collection c):Set<E>',
    Queue: 'offer(E e):boolean|poll():E|peek():E|element():E',
    Deque: 'push(E e):void|pop():E|offerFirst(E e):boolean|offerLast(E e):boolean|pollFirst():E|pollLast():E|peekFirst():E|peekLast():E|addFirst(E e):void|addLast(E e):void',
    Map: 'put(K key, V value):V|get(Object key):V|getOrDefault(Object key, V defaultValue):V|containsKey(Object key):boolean|containsValue(Object value):boolean|remove(Object key):V|size():int|isEmpty():boolean|keySet():Set<K>|values():Collection<V>|entrySet():Set<Entry>|putIfAbsent(K key, V value):V|computeIfAbsent(K key, Function fn):V|computeIfPresent(K key, BiFunction fn):V|compute(K key, BiFunction fn):V|merge(K key, V value, BiFunction fn):V|forEach(BiConsumer action):void|putAll(Map m):void|clear():void|+of(K k1, V v1):Map<K,V>|+entry(K k, V v):Entry',
    Entry: 'getKey():K|getValue():V|setValue(V value):V',
    Iterator: 'hasNext():boolean|next():E|remove():void',
    Stream: 'filter(Predicate predicate):Stream<T>|map(Function mapper):Stream|mapToInt(ToIntFunction mapper):IntStream|mapToLong(ToLongFunction mapper):LongStream|mapToDouble(ToDoubleFunction mapper):DoubleStream|flatMap(Function mapper):Stream|forEach(Consumer action):void|collect(Collector collector):R|toList():List<T>|sorted():Stream<T>|sorted(Comparator c):Stream<T>|distinct():Stream<T>|limit(long maxSize):Stream<T>|skip(long n):Stream<T>|count():long|anyMatch(Predicate p):boolean|allMatch(Predicate p):boolean|noneMatch(Predicate p):boolean|findFirst():Optional<T>|findAny():Optional<T>|reduce(T identity, BinaryOperator acc):T|min(Comparator c):Optional<T>|max(Comparator c):Optional<T>|peek(Consumer action):Stream<T>|toArray():Object[]|+of(T... values):Stream<T>|+empty():Stream<T>|+iterate(T seed, UnaryOperator f):Stream<T>|+generate(Supplier s):Stream<T>',
    IntStream: 'sum():int|average():OptionalDouble|max():OptionalInt|min():OptionalInt|count():long|boxed():Stream<Integer>|forEach(IntConsumer action):void|map(IntUnaryOperator mapper):IntStream|filter(IntPredicate p):IntStream|mapToObj(IntFunction mapper):Stream|toArray():int[]|+range(int startInclusive, int endExclusive):IntStream|+rangeClosed(int startInclusive, int endInclusive):IntStream|+of(int... values):IntStream',
    Optional: 'isPresent():boolean|isEmpty():boolean|get():T|orElse(T other):T|orElseGet(Supplier supplier):T|orElseThrow():T|ifPresent(Consumer action):void|ifPresentOrElse(Consumer action, Runnable emptyAction):void|map(Function mapper):Optional|flatMap(Function mapper):Optional|filter(Predicate p):Optional<T>|+of(T value):Optional<T>|+ofNullable(T value):Optional<T>|+empty():Optional<T>',
    Arrays: '+asList(T... a):List<T>|+sort(Object[] a):void|+toString(Object[] a):String|+deepToString(Object[] a):String|+fill(Object[] a, Object val):void|+copyOf(T[] original, int newLength):T[]|+copyOfRange(T[] original, int from, int to):T[]|+stream(T[] array):Stream<T>|+equals(Object[] a, Object[] b):boolean|+binarySearch(Object[] a, Object key):int|+hashCode(Object[] a):int',
    Collections: '+sort(List list):void|+reverse(List list):void|+shuffle(List list):void|+emptyList():List|+emptyMap():Map|+singletonList(T o):List<T>|+unmodifiableList(List list):List|+max(Collection c):T|+min(Collection c):T|+frequency(Collection c, Object o):int|+swap(List list, int i, int j):void|+addAll(Collection c, T... elements):boolean',
    Collectors: '+toList():Collector|+toSet():Collector|+joining(CharSequence delimiter):Collector|+groupingBy(Function classifier):Collector|+toMap(Function keyMapper, Function valueMapper):Collector|+counting():Collector|+partitioningBy(Predicate p):Collector|+summingInt(ToIntFunction f):Collector|+averagingDouble(ToDoubleFunction f):Collector',
    Number: 'intValue():int|longValue():long|doubleValue():double|floatValue():float|compareTo(Object o):int',
    Integer: '+parseInt(String s):int|+valueOf(String s):Integer|+toString(int i):String|+MAX_VALUE:int|+MIN_VALUE:int|+compare(int x, int y):int|+toBinaryString(int i):String|+toHexString(int i):String|+sum(int a, int b):int|+max(int a, int b):int|+min(int a, int b):int',
    Long: '+parseLong(String s):long|+valueOf(String s):Long|+toString(long i):String|+MAX_VALUE:long|+MIN_VALUE:long|+compare(long x, long y):int',
    Double: '+parseDouble(String s):double|+valueOf(String s):Double|+toString(double d):String|+compare(double a, double b):int|+isNaN(double v):boolean|+MAX_VALUE:double|+MIN_VALUE:double',
    Boolean: '+parseBoolean(String s):boolean|+valueOf(String s):Boolean|+TRUE:Boolean|+FALSE:Boolean',
    Character: '+isDigit(char ch):boolean|+isLetter(char ch):boolean|+isLetterOrDigit(char ch):boolean|+isWhitespace(char ch):boolean|+isUpperCase(char ch):boolean|+isLowerCase(char ch):boolean|+toUpperCase(char ch):char|+toLowerCase(char ch):char|+getNumericValue(char ch):int',
    Objects: '+equals(Object a, Object b):boolean|+requireNonNull(T obj):T|+requireNonNull(T obj, String message):T|+isNull(Object obj):boolean|+nonNull(Object obj):boolean|+hash(Object... values):int|+toString(Object o):String|+requireNonNullElse(T obj, T def):T',
    Scanner: 'nextLine():String|next():String|nextInt():int|nextLong():long|nextDouble():double|nextBoolean():boolean|hasNext():boolean|hasNextLine():boolean|hasNextInt():boolean|close():void',
    Thread: '+sleep(long millis):void|+currentThread():Thread|start():void|join():void|interrupt():void|isAlive():boolean|getName():String|setDaemon(boolean on):void|+ofVirtual():Builder',
    Files: '+readString(Path path):String|+readAllLines(Path path):List<String>|+readAllBytes(Path path):byte[]|+writeString(Path path, CharSequence csq):Path|+write(Path path, byte[] bytes):Path|+exists(Path path):boolean|+isDirectory(Path path):boolean|+createDirectories(Path dir):Path|+createFile(Path path):Path|+delete(Path path):void|+deleteIfExists(Path path):boolean|+list(Path dir):Stream<Path>|+walk(Path start):Stream<Path>|+lines(Path path):Stream<String>|+copy(Path source, Path target):Path|+move(Path source, Path target):Path|+size(Path path):long|+newBufferedReader(Path path):BufferedReader',
    Path: 'getFileName():Path|getParent():Path|resolve(String other):Path|toAbsolutePath():Path|normalize():Path|toFile():File|toString():String|startsWith(String other):boolean|+of(String first, String... more):Path',
    Paths: '+get(String first, String... more):Path',
    File: 'exists():boolean|isDirectory():boolean|isFile():boolean|getName():String|getPath():String|getAbsolutePath():String|length():long|delete():boolean|mkdirs():boolean|listFiles():File[]|toPath():Path',
    BufferedReader: 'readLine():String|lines():Stream<String>|close():void|ready():boolean',
    LocalDate: '+now():LocalDate|+of(int year, int month, int day):LocalDate|+parse(CharSequence text):LocalDate|plusDays(long days):LocalDate|minusDays(long days):LocalDate|plusMonths(long months):LocalDate|getYear():int|getMonthValue():int|getDayOfMonth():int|getDayOfWeek():DayOfWeek|isBefore(LocalDate other):boolean|isAfter(LocalDate other):boolean|format(DateTimeFormatter f):String|atStartOfDay():LocalDateTime',
    LocalDateTime: '+now():LocalDateTime|+of(int year, int month, int day, int hour, int minute):LocalDateTime|+parse(CharSequence text):LocalDateTime|plusHours(long hours):LocalDateTime|plusMinutes(long minutes):LocalDateTime|plusDays(long days):LocalDateTime|toLocalDate():LocalDate|getHour():int|getMinute():int|format(DateTimeFormatter f):String|isBefore(LocalDateTime other):boolean|isAfter(LocalDateTime other):boolean',
    Duration: '+ofSeconds(long seconds):Duration|+ofMillis(long millis):Duration|+ofMinutes(long minutes):Duration|+between(Temporal a, Temporal b):Duration|toMillis():long|getSeconds():long|toMinutes():long',
    Throwable: 'getMessage():String|printStackTrace():void|getCause():Throwable|getStackTrace():StackTraceElement[]|getLocalizedMessage():String|addSuppressed(Throwable t):void',
    Class: 'getName():String|getSimpleName():String|isInstance(Object obj):boolean|getDeclaredFields():Field[]|getDeclaredMethods():Method[]',
    '[]': 'length:int|clone():Object',
  },
  g: '',
  tpl: [
    ['sout', 'System.out.println($0);', 'imprime uma linha'], ['soutv', 'System.out.println("${1:valor} = " + ${1:valor});', 'imprime nome e valor'],
    ['souf', 'System.out.printf("$1%n"$2);', 'imprime formatado'], ['serr', 'System.err.println($0);', 'imprime no erro'],
    ['psvm', 'public static void main(String[] args) {\n\t$0\n}', 'método main'], ['main', 'public static void main(String[] args) {\n\t$0\n}', 'método main'],
    ['fori', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for com índice'], ['iter', 'for (${1:var} ${2:item} : ${3:itens}) {\n\t$0\n}', 'for-each'],
    ['itar', 'for (int ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n\t${3:var} ${4:e} = ${2:array}[${1:i}];\n\t$0\n}', 'percorre um array'],
    ['ifn', 'if (${1:x} == null) {\n\t$0\n}', 'se for null'], ['inn', 'if (${1:x} != null) {\n\t$0\n}', 'se não for null'],
    ['thr', 'throw new ${1:RuntimeException}($0);', 'lança exceção'], ['tryc', 'try {\n\t$1\n} catch (${2:Exception} e) {\n\t$0\n}', 'try/catch'],
    ['psf', 'public static final ${1:String} ${2:NOME} = $0;', 'constante pública'], ['prsf', 'private static final ${1:String} ${2:NOME} = $0;', 'constante privada'],
    ['psfs', 'public static final String ${1:NOME} = "$0";', 'constante String'], ['St', 'String ', 'String'],
    ['wh', 'while (${1:true}) {\n\t$0\n}', 'while'], ['sw', 'switch (${1:x}) {\n\tcase ${2:valor} -> $0\n\tdefault -> {}\n}', 'switch'],
    ['cls', 'public class ${1:Nome} {\n\t$0\n}', 'classe'], ['rec', 'public record ${1:Nome}(${2:String campo}) {}', 'record'],
    ['lam', '(${1:x}) -> $0', 'lambda'], ['geti', 'public static ${1:Classe} getInstance() {\n\treturn ${2:INSTANCE};\n}', 'getInstance'],
  ],
  pfx: [
    ['sout', 'System.out.println(EXPR);', 'imprime'], ['serr', 'System.err.println(EXPR);', 'imprime no erro'], ['var', 'var ${1:nome} = EXPR;', 'cria variável'],
    ['if', 'if (EXPR) {\n\t$0\n}', 'se verdadeiro'], ['not', '!EXPR', 'nega'], ['null', 'if (EXPR == null) {\n\t$0\n}', 'se null'], ['nn', 'if (EXPR != null) {\n\t$0\n}', 'se não null'],
    ['for', 'for (var ${1:item} : EXPR) {\n\t$0\n}', 'for-each'], ['fori', 'for (int ${1:i} = 0; ${1:i} < EXPR; ${1:i}++) {\n\t$0\n}', 'for até o valor'],
    ['return', 'return EXPR;', 'retorna'], ['par', '(EXPR)', 'entre parênteses'], ['cast', '((${1:Tipo}) EXPR)', 'converte o tipo'],
    ['throw', 'throw EXPR;', 'lança'], ['while', 'while (EXPR) {\n\t$0\n}', 'enquanto'], ['opt', 'Optional.ofNullable(EXPR)', 'Optional'], ['try', 'try {\n\tEXPR;\n} catch (${1:Exception} e) {\n\t$0\n}', 'try/catch'],
  ],
};

D.kotlin = {
  kw: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor companion data enum finally import init internal lateinit open override private protected public sealed suspend inline reified abstract const',
  stmt: 'if for while when return val var fun try throw',
  types: 'Int Long Double Float Boolean Char String Unit Any Byte Short',
  lit: { s: 'String' }, sep: ['.', '?.'],
  ext: { MutableList: 'List', ArrayList: 'MutableList', MutableMap: 'Map', HashMap: 'MutableMap', MutableSet: 'Set', List: 'Iterable', Set: 'Iterable', Array: 'Iterable', Int: 'Number', Long: 'Number', Double: 'Number' },
  T: {
    Any: 'toString():String|equals(other: Any?):Boolean|hashCode():Int|let(block):R|also(block):T|apply(block):T|run(block):R|takeIf(predicate):T?',
    String: 'length:Int|uppercase():String|lowercase():String|trim():String|split(delimiter):List<String>|substring(startIndex, endIndex):String|contains(other):Boolean|startsWith(prefix):Boolean|endsWith(suffix):Boolean|replace(oldValue, newValue):String|toInt():Int|toIntOrNull():Int?|toLong():Long|toDouble():Double|isEmpty():Boolean|isNotEmpty():Boolean|isBlank():Boolean|isNotBlank():Boolean|lines():List<String>|padStart(length, padChar):String|padEnd(length, padChar):String|first():Char|last():Char|reversed():String|repeat(n):String|indexOf(string):Int|format(args):String|toCharArray():CharArray|removePrefix(prefix):String|removeSuffix(suffix):String|equals(other, ignoreCase):Boolean|ifEmpty(defaultValue):String',
    Iterable: 'forEach(action):Unit|map(transform):List|filter(predicate):List<T>|first():T|firstOrNull():T?|last():T|find(predicate):T?|any(predicate):Boolean|all(predicate):Boolean|none(predicate):Boolean|count():Int|sum():Int|sumOf(selector):Int|maxOrNull():T?|minOrNull():T?|maxBy(selector):T|minBy(selector):T|sorted():List<T>|sortedBy(selector):List<T>|sortedDescending():List<T>|reversed():List<T>|distinct():List<T>|joinToString(separator):String|groupBy(keySelector):Map|associateBy(keySelector):Map|associate(transform):Map|flatMap(transform):List|zip(other):List|take(n):List<T>|drop(n):List<T>|chunked(size):List|windowed(size):List|toList():List<T>|toMutableList():MutableList<T>|toSet():Set<T>|forEachIndexed(action):Unit|mapIndexed(transform):List|filterNot(predicate):List<T>|partition(predicate):Pair|indexOf(element):Int|contains(element):Boolean|isEmpty():Boolean|isNotEmpty():Boolean|fold(initial, operation):R|reduce(operation):T|withIndex():Iterable',
    List: 'size:Int|get(index):E|indices:IntRange|lastIndex:Int|subList(fromIndex, toIndex):List<E>|getOrNull(index):E?|getOrElse(index, defaultValue):E',
    MutableList: 'add(element):Boolean|add(index, element):Unit|addAll(elements):Boolean|remove(element):Boolean|removeAt(index):E|removeIf(predicate):Boolean|clear():Unit|set(index, element):E|sort():Unit|shuffle():Unit',
    Map: 'size:Int|keys:Set<K>|values:Collection<V>|entries:Set|get(key):V?|getOrDefault(key, defaultValue):V|getOrElse(key, defaultValue):V|containsKey(key):Boolean|containsValue(value):Boolean|isEmpty():Boolean|forEach(action):Unit|map(transform):List|filter(predicate):Map<K,V>|mapValues(transform):Map|mapKeys(transform):Map|toMutableMap():MutableMap<K,V>|toList():List',
    MutableMap: 'put(key, value):V?|remove(key):V?|getOrPut(key, defaultValue):V|putAll(from):Unit|clear():Unit',
    Set: 'size:Int',
    Number: 'toInt():Int|toLong():Long|toDouble():Double|toFloat():Float|toString():String|coerceIn(minimumValue, maximumValue):T|coerceAtLeast(minimumValue):T|coerceAtMost(maximumValue):T',
    Pair: 'first:A|second:B',
  },
  g: 'println(message):Unit|print(message):Unit|readln():String|readLine():String?|listOf(elements):List|mutableListOf(elements):MutableList|arrayListOf(elements):ArrayList|mapOf(pairs):Map|mutableMapOf(pairs):MutableMap|hashMapOf(pairs):HashMap|setOf(elements):Set|mutableSetOf(elements):MutableSet|arrayOf(elements):Array|emptyList():List|emptyMap():Map|require(value):Unit|requireNotNull(value):T|check(value):Unit|error(message):Nothing|TODO(reason):Nothing|repeat(times, action):Unit|maxOf(a, b):T|minOf(a, b):T|lazy(initializer):Lazy|buildString(builderAction):String|buildList(builderAction):List|with(receiver, block):R|run(block):R',
  tpl: [
    ['main', 'fun main() {\n\t$0\n}', 'função main'], ['maina', 'fun main(args: Array<String>) {\n\t$0\n}', 'main com argumentos'],
    ['sout', 'println($0)', 'imprime'], ['soutv', 'println("${1:valor} = \\$${1:valor}")', 'imprime nome e valor'], ['fun', 'fun ${1:nome}($2)${3:: Unit} {\n\t$0\n}', 'função'],
    ['iter', 'for (${1:item} in ${2:itens}) {\n\t$0\n}', 'for'], ['fori', 'for (${1:i} in 0 until ${2:n}) {\n\t$0\n}', 'for com índice'],
    ['ifn', 'if (${1:x} == null) {\n\t$0\n}', 'se null'], ['inn', 'if (${1:x} != null) {\n\t$0\n}', 'se não null'], ['when', 'when (${1:x}) {\n\t${2:valor} -> $0\n\telse -> {}\n}', 'when'],
    ['data', 'data class ${1:Nome}(val ${2:campo}: ${3:String})', 'data class'], ['cls', 'class ${1:Nome} {\n\t$0\n}', 'classe'], ['obj', 'object ${1:Nome} {\n\t$0\n}', 'object'],
    ['tryc', 'try {\n\t$1\n} catch (e: ${2:Exception}) {\n\t$0\n}', 'try/catch'],
  ],
  pfx: [
    ['sout', 'println(EXPR)', 'imprime'], ['val', 'val ${1:nome} = EXPR', 'cria val'], ['var', 'var ${1:nome} = EXPR', 'cria var'], ['if', 'if (EXPR) {\n\t$0\n}', 'se verdadeiro'],
    ['not', '!EXPR', 'nega'], ['null', 'if (EXPR == null) {\n\t$0\n}', 'se null'], ['nn', 'if (EXPR != null) {\n\t$0\n}', 'se não null'], ['for', 'for (${1:item} in EXPR) {\n\t$0\n}', 'for'],
    ['return', 'return EXPR', 'retorna'], ['let', 'EXPR?.let { $0 }', 'let'], ['when', 'when (EXPR) {\n\t$0\n}', 'when'], ['par', '(EXPR)', 'parênteses'],
  ],
};

D.csharp = {
  kw: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while async await record get set init yield nameof',
  stmt: 'if for foreach while switch return try throw using var await new',
  types: 'int long double float bool char string object decimal byte void var',
  lit: { s: 'string' }, sep: ['.', '?.'], newKw: true,
  ext: { String: 'string', List: 'IEnumerable', 'HashSet': 'IEnumerable', 'Dictionary': 'IEnumerable', 'Array': 'IEnumerable', Exception: 'object', IEnumerable: 'object' },
  T: {
    object: 'ToString():string|Equals(object obj):bool|GetHashCode():int|GetType():Type',
    Console: '+WriteLine(object value):void|+Write(object value):void|+ReadLine():string|+ReadKey():ConsoleKeyInfo|+Clear():void|+ForegroundColor:ConsoleColor|+ResetColor():void|+Beep():void',
    string: 'Length:int|Substring(int startIndex, int length):string|Contains(string value):bool|StartsWith(string value):bool|EndsWith(string value):bool|IndexOf(string value):int|LastIndexOf(string value):int|Replace(string oldValue, string newValue):string|Split(char separator):string[]|Trim():string|TrimStart():string|TrimEnd():string|ToUpper():string|ToLower():string|PadLeft(int totalWidth):string|PadRight(int totalWidth):string|ToCharArray():char[]|Insert(int startIndex, string value):string|Remove(int startIndex):string|Equals(string value):bool|CompareTo(string strB):int|+IsNullOrEmpty(string value):bool|+IsNullOrWhiteSpace(string value):bool|+Join(string separator, IEnumerable values):string|+Format(string format, object arg0):string|+Concat(string str0, string str1):string|+Empty:string',
    Math: '+Abs(double value):double|+Max(double a, double b):double|+Min(double a, double b):double|+Pow(double x, double y):double|+Sqrt(double d):double|+Round(double a):double|+Floor(double d):double|+Ceiling(double a):double|+PI:double|+Clamp(double value, double min, double max):double',
    IEnumerable: 'Where(Func predicate):IEnumerable<T>|Select(Func selector):IEnumerable|SelectMany(Func selector):IEnumerable|First():T|FirstOrDefault():T|Last():T|LastOrDefault():T|Single():T|Any():bool|All(Func predicate):bool|Count():int|Sum():int|Max():T|Min():T|Average():double|OrderBy(Func keySelector):IEnumerable<T>|OrderByDescending(Func keySelector):IEnumerable<T>|GroupBy(Func keySelector):IEnumerable|Distinct():IEnumerable<T>|Take(int count):IEnumerable<T>|Skip(int count):IEnumerable<T>|ToList():List<T>|ToArray():T[]|ToDictionary(Func keySelector):Dictionary|Contains(T value):bool|Aggregate(Func func):T',
    List: 'Add(T item):void|AddRange(IEnumerable collection):void|Remove(T item):bool|RemoveAt(int index):void|RemoveAll(Predicate match):int|Insert(int index, T item):void|Clear():void|IndexOf(T item):int|Sort():void|Reverse():void|ForEach(Action action):void|Find(Predicate match):T|FindAll(Predicate match):List<T>|Exists(Predicate match):bool|Count:int|Capacity:int',
    Dictionary: 'Add(TKey key, TValue value):void|ContainsKey(TKey key):bool|ContainsValue(TValue value):bool|Remove(TKey key):bool|TryGetValue(TKey key, out TValue value):bool|TryAdd(TKey key, TValue value):bool|GetValueOrDefault(TKey key):TValue|Clear():void|Keys:KeyCollection|Values:ValueCollection|Count:int',
    Convert: '+ToInt32(object value):int|+ToInt64(object value):long|+ToDouble(object value):double|+ToString(object value):string|+ToBoolean(object value):bool|+ToDecimal(object value):decimal|+ToBase64String(byte[] inArray):string|+FromBase64String(string s):byte[]',
    int: '+Parse(string s):int|+TryParse(string s, out int result):bool|+MaxValue:int|+MinValue:int',
    DateTime: '+Now:DateTime|+UtcNow:DateTime|+Today:DateTime|+Parse(string s):DateTime|AddDays(double value):DateTime|AddHours(double value):DateTime|AddMinutes(double value):DateTime|ToString(string format):string|Year:int|Month:int|Day:int|Hour:int|DayOfWeek:DayOfWeek|Date:DateTime',
    File: '+ReadAllText(string path):string|+ReadAllLines(string path):string[]|+WriteAllText(string path, string contents):void|+AppendAllText(string path, string contents):void|+Exists(string path):bool|+Delete(string path):void|+Copy(string source, string dest):void|+ReadAllTextAsync(string path):Task<string>',
    Path: '+Combine(string path1, string path2):string|+GetFileName(string path):string|+GetExtension(string path):string|+GetDirectoryName(string path):string|+GetFullPath(string path):string',
    Task: '+Delay(int millisecondsDelay):Task|+Run(Action action):Task|+WhenAll(Task[] tasks):Task|+FromResult(T result):Task<T>|Wait():void|Result:T|ConfigureAwait(bool continueOnCapturedContext):ConfiguredTaskAwaitable',
    Guid: '+NewGuid():Guid|+Parse(string input):Guid|+Empty:Guid|ToString():string',
    StringBuilder: 'Append(object value):StringBuilder|AppendLine(string value):StringBuilder|Insert(int index, string value):StringBuilder|ToString():string|Clear():StringBuilder|Length:int|Replace(string oldValue, string newValue):StringBuilder',
    Exception: 'Message:string|StackTrace:string|InnerException:Exception|Source:string',
  },
  g: 'nameof(expression):string|typeof(type):Type',
  tpl: [
    ['cw', 'Console.WriteLine($0);', 'imprime'], ['svm', 'static void Main(string[] args)\n{\n\t$0\n}', 'método Main'], ['prop', 'public ${1:int} ${2:Nome} { get; set; }', 'propriedade'],
    ['propg', 'public ${1:int} ${2:Nome} { get; }', 'propriedade só leitura'], ['ctor', 'public ${1:Classe}()\n{\n\t$0\n}', 'construtor'],
    ['for', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++)\n{\n\t$0\n}', 'for'], ['foreach', 'foreach (var ${1:item} in ${2:itens})\n{\n\t$0\n}', 'foreach'],
    ['tryc', 'try\n{\n\t$1\n}\ncatch (${2:Exception} ex)\n{\n\t$0\n}', 'try/catch'], ['cls', 'public class ${1:Nome}\n{\n\t$0\n}', 'classe'], ['rec', 'public record ${1:Nome}(${2:string Campo});', 'record'],
    ['ifn', 'if (${1:x} is null)\n{\n\t$0\n}', 'se null'], ['thr', 'throw new ${1:InvalidOperationException}($0);', 'lança'],
  ],
  pfx: [
    ['cw', 'Console.WriteLine(EXPR);', 'imprime'], ['var', 'var ${1:nome} = EXPR;', 'cria variável'], ['if', 'if (EXPR)\n{\n\t$0\n}', 'se verdadeiro'], ['not', '!EXPR', 'nega'],
    ['null', 'if (EXPR is null)\n{\n\t$0\n}', 'se null'], ['nn', 'if (EXPR is not null)\n{\n\t$0\n}', 'se não null'], ['foreach', 'foreach (var ${1:item} in EXPR)\n{\n\t$0\n}', 'foreach'],
    ['return', 'return EXPR;', 'retorna'], ['await', 'await EXPR', 'await'], ['par', '(EXPR)', 'parênteses'], ['throw', 'throw EXPR;', 'lança'],
  ],
};

D.go = {
  kw: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota',
  stmt: 'if for switch select return defer go var const type func',
  types: 'int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 string bool byte rune error any',
  lit: {}, sep: ['.'],
  T: {
    '@fmt': 'Println(a ...any):(n int, err error)|Printf(format string, a ...any):(n int, err error)|Sprintf(format string, a ...any):string|Sprint(a ...any):string|Sprintln(a ...any):string|Errorf(format string, a ...any):error|Print(a ...any):(n int, err error)|Fprintf(w io.Writer, format string, a ...any):(n int, err error)|Fprintln(w io.Writer, a ...any):(n int, err error)|Scan(a ...any):(n int, err error)|Scanln(a ...any):(n int, err error)|Sscanf(str string, format string, a ...any):(n int, err error)',
    '@strings': 'Contains(s, substr string):bool|HasPrefix(s, prefix string):bool|HasSuffix(s, suffix string):bool|Split(s, sep string):[]string|Join(elems []string, sep string):string|Replace(s, old, new string, n int):string|ReplaceAll(s, old, new string):string|ToUpper(s string):string|ToLower(s string):string|TrimSpace(s string):string|Trim(s, cutset string):string|TrimPrefix(s, prefix string):string|TrimSuffix(s, suffix string):string|Index(s, substr string):int|Fields(s string):[]string|Repeat(s string, count int):string|EqualFold(s, t string):bool|Count(s, substr string):int|Cut(s, sep string):(before, after string, found bool)|NewReader(s string):*Reader|Builder:Builder',
    '@strconv': 'Itoa(i int):string|Atoi(s string):(int, error)|ParseFloat(s string, bitSize int):(float64, error)|ParseInt(s string, base int, bitSize int):(int64, error)|FormatInt(i int64, base int):string|ParseBool(str string):(bool, error)|FormatFloat(f float64, fmt byte, prec, bitSize int):string|Quote(s string):string',
    '@os': 'Args:[]string|Exit(code int)|Getenv(key string):string|Setenv(key, value string):error|ReadFile(name string):([]byte, error)|WriteFile(name string, data []byte, perm FileMode):error|Open(name string):(*File, error)|Create(name string):(*File, error)|Remove(name string):error|RemoveAll(path string):error|MkdirAll(path string, perm FileMode):error|Getwd():(dir string, err error)|Stdout:*File|Stderr:*File|Stdin:*File|ReadDir(name string):([]DirEntry, error)|Stat(name string):(FileInfo, error)|IsNotExist(err error):bool',
    '@errors': 'New(text string):error|Is(err, target error):bool|As(err error, target any):bool|Unwrap(err error):error|Join(errs ...error):error',
    '@time': 'Now():Time|Sleep(d Duration)|Since(t Time):Duration|Until(t Time):Duration|After(d Duration):<-chan Time|Tick(d Duration):<-chan Time|NewTimer(d Duration):*Timer|NewTicker(d Duration):*Ticker|Parse(layout, value string):(Time, error)|Unix(sec int64, nsec int64):Time|Nanosecond:Duration|Millisecond:Duration|Second:Duration|Minute:Duration|Hour:Duration|RFC3339:string|Duration:Duration',
    '@math': 'Abs(x float64):float64|Max(x, y float64):float64|Min(x, y float64):float64|Sqrt(x float64):float64|Pow(x, y float64):float64|Floor(x float64):float64|Ceil(x float64):float64|Round(x float64):float64|Log(x float64):float64|Pi:float64|Inf(sign int):float64|MaxInt:int|MinInt:int|MaxInt64:int64',
    '@sort': 'Strings(x []string)|Ints(x []int)|Slice(x any, less func(i, j int) bool)|SliceStable(x any, less func(i, j int) bool)|Search(n int, f func(int) bool):int',
    '@slices': 'Sort(x S)|Contains(s S, v E):bool|Index(s S, v E):int|Reverse(s S)|Max(x S):E|Min(x S):E|Equal(s1, s2 S):bool|SortFunc(x S, cmp func(a, b E) int)',
    '@sync': 'WaitGroup:WaitGroup|Mutex:Mutex|RWMutex:RWMutex|Once:Once|Map:Map',
    '@json': 'Marshal(v any):([]byte, error)|MarshalIndent(v any, prefix, indent string):([]byte, error)|Unmarshal(data []byte, v any):error|NewEncoder(w io.Writer):*Encoder|NewDecoder(r io.Reader):*Decoder',
    '@http': 'Get(url string):(*Response, error)|Post(url, contentType string, body io.Reader):(*Response, error)|ListenAndServe(addr string, handler Handler):error|HandleFunc(pattern string, handler func(ResponseWriter, *Request))|Handle(pattern string, handler Handler)|NewRequest(method, url string, body io.Reader):(*Request, error)|Error(w ResponseWriter, error string, code int)|StatusOK:int|StatusNotFound:int|StatusInternalServerError:int|MethodGet:string|MethodPost:string|DefaultClient:*Client',
    '@filepath': 'Join(elem ...string):string|Base(path string):string|Dir(path string):string|Ext(path string):string|Abs(path string):(string, error)|Walk(root string, fn WalkFunc):error|WalkDir(root string, fn fs.WalkDirFunc):error|Glob(pattern string):([]string, error)|Rel(basepath, targpath string):(string, error)',
    '@io': 'ReadAll(r Reader):([]byte, error)|Copy(dst Writer, src Reader):(int64, error)|EOF:error|Discard:Writer|WriteString(w Writer, s string):(int, error)',
    '@bufio': 'NewScanner(r io.Reader):*Scanner|NewReader(rd io.Reader):*Reader|NewWriter(w io.Writer):*Writer|ScanLines:SplitFunc|ScanWords:SplitFunc',
    '@context': 'Background():Context|TODO():Context|WithCancel(parent Context):(Context, CancelFunc)|WithTimeout(parent Context, timeout time.Duration):(Context, CancelFunc)|WithValue(parent Context, key, val any):Context',
    '@log': 'Println(v ...any)|Printf(format string, v ...any)|Fatal(v ...any)|Fatalf(format string, v ...any)|Panic(v ...any)|SetFlags(flag int)|SetPrefix(prefix string)',
    '@testing': 'T:T|B:B',
    Time: 'Format(layout string):string|Unix():int64|UnixMilli():int64|Year():int|Month():Month|Day():int|Hour():int|Add(d Duration):Time|Sub(u Time):Duration|Before(u Time):bool|After(u Time):bool|Equal(u Time):bool|IsZero():bool|AddDate(years int, months int, days int):Time',
    Duration: 'Seconds():float64|Milliseconds():int64|Minutes():float64|String():string',
    Scanner: 'Scan():bool|Text():string|Err():error|Bytes():[]byte|Split(split SplitFunc)|Buffer(buf []byte, max int)',
    WaitGroup: 'Add(delta int)|Done()|Wait()|Go(f func())', Mutex: 'Lock()|Unlock()|TryLock():bool', RWMutex: 'Lock()|Unlock()|RLock()|RUnlock()',
    Builder: 'WriteString(s string):(int, error)|WriteByte(c byte):error|WriteRune(r rune):(int, error)|String():string|Len():int|Reset()|Grow(n int)',
    File: 'Close():error|Write(b []byte):(n int, err error)|WriteString(s string):(n int, err error)|Read(b []byte):(n int, err error)|Name():string|Stat():(FileInfo, error)|Sync():error',
    Response: 'StatusCode:int|Body:io.ReadCloser|Header:Header|Status:string',
    Request: 'Method:string|URL:*url.URL|Header:Header|Body:io.ReadCloser|Context():context.Context|FormValue(key string):string|PathValue(name string):string',
    ResponseWriter: 'Header():Header|Write(b []byte):(int, error)|WriteHeader(statusCode int)',
    T: 'Errorf(format string, args ...any)|Fatalf(format string, args ...any)|Error(args ...any)|Fatal(args ...any)|Log(args ...any)|Logf(format string, args ...any)|Run(name string, f func(t *T)):bool|Helper()|Skip(args ...any)|Parallel()|Cleanup(f func())|TempDir():string',
    Context: 'Done():<-chan struct{}|Err():error|Value(key any):any|Deadline():(deadline time.Time, ok bool)',
    error: 'Error():string',
  },
  g: 'append(slice []T, elems ...T):[]T|len(v Type):int|cap(v Type):int|make(t Type, size ...int):Type|new(Type):*Type|delete(m map[K]V, key K)|copy(dst, src []T):int|panic(v any)|recover():any|print(args ...Type)|println(args ...Type)|close(c chan<- T)|min(x T, y ...T):T|max(x T, y ...T):T|clear(t T)',
  tpl: [
    ['main', 'func main() {\n\t$0\n}', 'função main'], ['pkgm', 'package main\n\nimport "fmt"\n\nfunc main() {\n\t$0\n}', 'programa'], ['iferr', 'if err != nil {\n\treturn ${1:err}\n}', 'trata erro'],
    ['ife', 'if err != nil {\n\t${1:log.Fatal(err)}\n}', 'trata erro'], ['forr', 'for ${1:_}, ${2:v} := range ${3:itens} {\n\t$0\n}', 'for range'], ['fori', 'for ${1:i} := 0; ${1:i} < ${2:n}; ${1:i}++ {\n\t$0\n}', 'for com índice'],
    ['pr', 'fmt.Println($0)', 'imprime'], ['pf', 'fmt.Printf("$1\\n", $2)', 'imprime formatado'], ['sf', 'fmt.Sprintf("$1", $2)', 'Sprintf'], ['ef', 'fmt.Errorf("$1: %w", ${2:err})', 'erro embrulhado'],
    ['func', 'func ${1:nome}($2) ${3:error} {\n\t$0\n}', 'função'], ['meth', 'func (${1:r} *${2:Tipo}) ${3:Nome}($4) {\n\t$0\n}', 'método'],
    ['st', 'type ${1:Nome} struct {\n\t$0\n}', 'struct'], ['inf', 'type ${1:Nome} interface {\n\t$0\n}', 'interface'], ['test', 'func Test${1:Nome}(t *testing.T) {\n\t$0\n}', 'teste'],
    ['gor', 'go func() {\n\t$0\n}()', 'goroutine'], ['sel', 'select {\ncase ${1:v} := <-${2:ch}:\n\t$0\n}', 'select'],
  ],
  pfx: [
    ['print', 'fmt.Println(EXPR)', 'imprime'], ['var', '${1:nome} := EXPR', 'cria variável'], ['if', 'if EXPR {\n\t$0\n}', 'se verdadeiro'], ['not', '!EXPR', 'nega'],
    ['nil', 'if EXPR == nil {\n\t$0\n}', 'se nil'], ['nn', 'if EXPR != nil {\n\t$0\n}', 'se não nil'], ['for', 'for _, ${1:v} := range EXPR {\n\t$0\n}', 'for range'],
    ['return', 'return EXPR', 'retorna'], ['len', 'len(EXPR)', 'tamanho'], ['par', '(EXPR)', 'parênteses'],
  ],
};

const RS_ITER = 'map(f):Iter|filter(predicate):Iter|filter_map(f):Iter|collect():B|enumerate():Iter|sum():S|count():usize|for_each(f)|any(f):bool|all(f):bool|find(predicate):Option<T>|position(predicate):Option<usize>|rev():Iter|zip(other):Iter|take(n):Iter|skip(n):Iter|fold(init, f):B|max():Option<T>|min():Option<T>|max_by_key(f):Option<T>|cloned():Iter|copied():Iter|flat_map(f):Iter|chain(other):Iter|peekable():Iter|last():Option<T>|nth(n):Option<T>|next():Option<T>|step_by(step):Iter|take_while(predicate):Iter|skip_while(predicate):Iter|partition(f):(B, B)|join(sep):String';
D.rust = {
  kw: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  stmt: 'let if for while loop match return fn use impl struct enum pub',
  types: 'i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box Rc Arc RefCell HashMap HashSet',
  lit: { s: 'str' }, sep: ['.', '::'],
  ext: { String: 'str', Vec: 'slice', Iter: 'Iterator', Chars: 'Iterator', Lines: 'Iterator', Split: 'Iterator', IntoIter: 'Iterator', Keys: 'Iterator', Values: 'Iterator', Args: 'Iterator', ReadDir: 'Iterator' },
  T: {
    str: 'len():usize|is_empty():bool|contains(pat):bool|starts_with(pat):bool|ends_with(pat):bool|find(pat):Option<usize>|split(pat):Split|split_whitespace():Split|trim():&str|trim_start():&str|trim_end():&str|to_uppercase():String|to_lowercase():String|replace(from, to):String|chars():Chars|bytes():Bytes|lines():Lines|parse():Result|to_string():String|to_owned():String|as_bytes():&[u8]|char_indices():Iter|repeat(n):String|strip_prefix(prefix):Option<&str>|strip_suffix(suffix):Option<&str>|eq_ignore_ascii_case(other):bool|get(range):Option<&str>',
    String: '+new():String|+from(s):String|+with_capacity(capacity):String|push_str(string)|push(ch)|pop():Option<char>|as_str():&str|clear()|insert(idx, ch)|insert_str(idx, string)|truncate(new_len)|capacity():usize|clone():String|into_bytes():Vec<u8>|remove(idx):char|retain(f)|drain(range):Drain',
    slice: 'len():usize|is_empty():bool|iter():Iter|iter_mut():Iter|contains(x):bool|first():Option<&T>|last():Option<&T>|get(index):Option<&T>|get_mut(index):Option<&mut T>|sort()|sort_by(compare)|sort_by_key(f)|sort_unstable()|binary_search(x):Result|join(sep):String|concat():Vec|reverse()|windows(size):Iter|chunks(size):Iter|to_vec():Vec<T>|split_at(mid):(&[T], &[T])|swap(a, b)|starts_with(needle):bool',
    Vec: '+new():Vec|+with_capacity(capacity):Vec|push(value)|pop():Option<T>|insert(index, element)|remove(index):T|swap_remove(index):T|clear()|truncate(len)|extend(iter)|retain(f)|dedup()|drain(range):Drain|into_iter():IntoIter|capacity():usize|clone():Vec<T>|append(other)|split_off(at):Vec<T>|resize(new_len, value)|as_slice():&[T]',
    Iterator: RS_ITER,
    Option: 'is_some():bool|is_none():bool|unwrap():T|expect(msg):T|unwrap_or(default):T|unwrap_or_default():T|unwrap_or_else(f):T|map(f):Option|and_then(f):Option|or(optb):Option<T>|or_else(f):Option<T>|ok_or(err):Result|ok_or_else(f):Result|as_ref():Option<&T>|as_mut():Option<&mut T>|take():Option<T>|cloned():Option<T>|filter(predicate):Option<T>|iter():Iter|is_some_and(f):bool|unwrap_unchecked():T',
    Result: 'is_ok():bool|is_err():bool|unwrap():T|expect(msg):T|unwrap_err():E|unwrap_or(default):T|unwrap_or_default():T|unwrap_or_else(f):T|map(f):Result|map_err(f):Result|and_then(f):Result|ok():Option<T>|err():Option<E>|as_ref():Result',
    HashMap: '+new():HashMap|+with_capacity(capacity):HashMap|insert(k, v):Option<V>|get(k):Option<&V>|get_mut(k):Option<&mut V>|contains_key(k):bool|remove(k):Option<V>|entry(key):Entry|len():usize|is_empty():bool|keys():Keys|values():Values|values_mut():Values|iter():Iter|iter_mut():Iter|clear()|extend(iter)|retain(f)|into_keys():IntoIter|into_values():IntoIter',
    HashSet: '+new():HashSet|insert(value):bool|contains(value):bool|remove(value):bool|len():usize|is_empty():bool|iter():Iter|union(other):Iter|intersection(other):Iter|difference(other):Iter|clear()|extend(iter)',
    Entry: 'or_insert(default):&mut V|or_insert_with(f):&mut V|or_default():&mut V|and_modify(f):Entry|key():&K',
    Box: '+new(x):Box', Rc: '+new(value):Rc|+clone(this):Rc|+strong_count(this):usize', Arc: '+new(data):Arc|+clone(this):Arc', RefCell: '+new(value):RefCell|borrow():Ref|borrow_mut():RefMut',
    '@fs': 'read_to_string(path):Result<String>|read(path):Result<Vec>|write(path, contents):Result|create_dir_all(path):Result|remove_file(path):Result|remove_dir_all(path):Result|read_dir(path):Result<ReadDir>|copy(from, to):Result<u64>|rename(from, to):Result|metadata(path):Result<Metadata>|File:File',
    '@env': 'args():Args|var(key):Result<String>|vars():Vars|current_dir():Result<PathBuf>|set_var(key, value)',
    '@io': 'stdin():Stdin|stdout():Stdout|stderr():Stderr|Result:Result|Error:Error|BufReader:BufReader|Write:Write|Read:Read',
    '@thread': 'spawn(f):JoinHandle|sleep(dur)|current():Thread',
    '@process': 'exit(code):!|Command:Command|id():u32',
    '@mem': 'swap(x, y)|replace(dest, src):T|take(dest):T|drop(x)|size_of():usize',
    '@std': 'fs:@fs|env:@env|io:@io|thread:@thread|process:@process|mem:@mem|collections:@collections|time:@time',
    '@collections': 'HashMap:HashMap|HashSet:HashSet|BTreeMap:HashMap|VecDeque:Vec',
    '@time': 'Duration:Duration|Instant:Instant',
    Duration: '+from_secs(secs):Duration|+from_millis(millis):Duration|as_secs():u64|as_millis():u128|as_secs_f64():f64',
    Instant: '+now():Instant|elapsed():Duration|duration_since(earlier):Duration',
    JoinHandle: 'join():Result',
    Stdin: 'read_line(buf):Result<usize>|lines():Lines|lock():StdinLock',
  },
  g: 'println!($1)|print!($1)|eprintln!($1)|format!($1):String|vec![$1]:Vec|panic!($1)|assert!($1)|assert_eq!($1, $2)|assert_ne!($1, $2)|todo!()|unimplemented!()|unreachable!()|dbg!($1)|write!($1)|writeln!($1)|matches!($1)|Some(value):Option|None:Option|Ok(value):Result|Err(error):Result|drop(x)',
  tpl: [
    ['main', 'fn main() {\n\t$0\n}', 'função main'], ['fn', 'fn ${1:nome}($2)${3: -> ${4:()}} {\n\t$0\n}', 'função'], ['pl', 'println!("$1"$2);', 'imprime'], ['pd', 'println!("{:?}", $1);', 'imprime debug'],
    ['pfn', 'pub fn ${1:nome}($2) {\n\t$0\n}', 'função pública'], ['test', '#[test]\nfn ${1:nome}() {\n\t$0\n}', 'teste'], ['tmod', '#[cfg(test)]\nmod tests {\n\tuse super::*;\n\n\t#[test]\n\tfn ${1:nome}() {\n\t\t$0\n\t}\n}', 'módulo de testes'],
    ['st', 'struct ${1:Nome} {\n\t$0\n}', 'struct'], ['en', 'enum ${1:Nome} {\n\t$0\n}', 'enum'], ['impl', 'impl ${1:Tipo} {\n\t$0\n}', 'impl'], ['tr', 'trait ${1:Nome} {\n\t$0\n}', 'trait'],
    ['for', 'for ${1:x} in ${2:iter} {\n\t$0\n}', 'for'], ['ifl', 'if let Some(${1:x}) = ${2:opcao} {\n\t$0\n}', 'if let'], ['match', 'match ${1:x} {\n\t${2:padrao} => $0,\n\t_ => {}\n}', 'match'],
    ['der', '#[derive(Debug, Clone$1)]', 'derive'], ['new', 'pub fn new($1) -> Self {\n\tSelf { $0 }\n}', 'construtor'],
  ],
  pfx: [
    ['println', 'println!("{:?}", EXPR);', 'imprime'], ['dbg', 'dbg!(EXPR)', 'dbg!'], ['let', 'let ${1:nome} = EXPR;', 'cria variável'], ['if', 'if EXPR {\n\t$0\n}', 'se verdadeiro'],
    ['not', '!EXPR', 'nega'], ['match', 'match EXPR {\n\t$0\n}', 'match'], ['for', 'for ${1:x} in EXPR {\n\t$0\n}', 'for'], ['ok', 'Ok(EXPR)', 'Ok'], ['some', 'Some(EXPR)', 'Some'],
    ['ref', '&EXPR', 'referência'], ['refm', '&mut EXPR', 'referência mutável'], ['return', 'return EXPR;', 'retorna'], ['box', 'Box::new(EXPR)', 'Box'],
  ],
};

D.python = {
  kw: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self',
  stmt: 'if for while def class return import from try with raise pass break continue elif else except finally async await yield',
  types: 'int str float bool list dict set tuple bytes object',
  lit: { s: 'str', l: 'list', d: 'dict' }, sep: ['.'], ctorCall: true,
  ext: { Path: 'object', defaultdict: 'dict', OrderedDict: 'dict', Counter: 'dict', deque: 'list' },
  T: {
    object: '__init__(self):None|__str__():str|__repr__():str|__dict__:dict',
    str: 'upper():str|lower():str|strip(chars=None):str|lstrip(chars=None):str|rstrip(chars=None):str|split(sep=None, maxsplit=-1):list|rsplit(sep=None):list|join(iterable):str|replace(old, new, count=-1):str|startswith(prefix):bool|endswith(suffix):bool|find(sub):int|rfind(sub):int|index(sub):int|count(sub):int|format(*args, **kwargs):str|encode(encoding="utf-8"):bytes|isdigit():bool|isalpha():bool|isalnum():bool|isspace():bool|isupper():bool|islower():bool|title():str|capitalize():str|splitlines():list|zfill(width):str|center(width):str|ljust(width):str|rjust(width):str|partition(sep):tuple|casefold():str|removeprefix(prefix):str|removesuffix(suffix):str|swapcase():str',
    list: 'append(x):None|extend(iterable):None|insert(i, x):None|remove(x):None|pop(i=-1):T|clear():None|index(x):int|count(x):int|sort(key=None, reverse=False):None|reverse():None|copy():list',
    dict: 'keys():dict_keys|values():dict_values|items():dict_items|get(key, default=None):V|pop(key, default=None):V|setdefault(key, default=None):V|update(other):None|clear():None|copy():dict|popitem():tuple|+fromkeys(iterable, value=None):dict',
    set: 'add(x):None|remove(x):None|discard(x):None|union(*others):set|intersection(*others):set|difference(*others):set|symmetric_difference(other):set|update(*others):None|pop():T|clear():None|issubset(other):bool|issuperset(other):bool|copy():set',
    tuple: 'count(x):int|index(x):int',
    bytes: 'decode(encoding="utf-8"):str|hex():str|startswith(prefix):bool|split(sep=None):list',
    file: 'read(size=-1):str|readline():str|readlines():list|write(s):int|writelines(lines):None|close():None|seek(offset):int|flush():None',
    '@os': 'getcwd():str|listdir(path="."):list|makedirs(name, exist_ok=False):None|mkdir(path):None|remove(path):None|rename(src, dst):None|environ:dict|getenv(key, default=None):str|path:@os.path|system(command):int|walk(top):iterator|sep:str|linesep:str|chdir(path):None|cpu_count():int|getpid():int|scandir(path="."):iterator',
    '@os.path': 'join(*paths):str|exists(path):bool|isfile(path):bool|isdir(path):bool|basename(path):str|dirname(path):str|abspath(path):str|splitext(path):tuple|getsize(path):int|expanduser(path):str|relpath(path, start="."):str|getmtime(path):float',
    '@sys': 'argv:list|exit(code=0):None|path:list|stdin:file|stdout:file|stderr:file|platform:str|version:str|executable:str|modules:dict|getsizeof(obj):int',
    '@re': 'match(pattern, string, flags=0):Match|search(pattern, string, flags=0):Match|fullmatch(pattern, string):Match|findall(pattern, string):list|finditer(pattern, string):iterator|sub(pattern, repl, string, count=0):str|split(pattern, string):list|compile(pattern, flags=0):Pattern|escape(pattern):str|IGNORECASE:int|MULTILINE:int|DOTALL:int',
    Match: 'group(n=0):str|groups():tuple|groupdict():dict|start(n=0):int|end(n=0):int|span(n=0):tuple',
    Pattern: 'match(string):Match|search(string):Match|findall(string):list|sub(repl, string):str|split(string):list|finditer(string):iterator',
    '@json': 'loads(s):dict|dumps(obj, indent=None, ensure_ascii=True):str|load(fp):dict|dump(obj, fp, indent=None):None|JSONDecodeError:Exception',
    '@math': 'sqrt(x):float|floor(x):int|ceil(x):int|pi:float|e:float|inf:float|nan:float|pow(x, y):float|log(x, base=e):float|log10(x):float|sin(x):float|cos(x):float|tan(x):float|fabs(x):float|isclose(a, b):bool|gcd(a, b):int|factorial(n):int|hypot(x, y):float|isnan(x):bool|prod(iterable):float',
    '@random': 'randint(a, b):int|random():float|choice(seq):T|choices(population, k=1):list|shuffle(x):None|sample(population, k):list|uniform(a, b):float|seed(a=None):None|randrange(start, stop):int',
    '@time': 'time():float|sleep(secs):None|perf_counter():float|monotonic():float|strftime(format):str|localtime():struct_time',
    '@datetime': 'datetime:datetime|date:date|timedelta:timedelta|timezone:timezone',
    datetime: '+now():datetime|+today():datetime|+fromisoformat(s):datetime|+strptime(s, format):datetime|strftime(format):str|isoformat():str|year:int|month:int|day:int|hour:int|minute:int|date():date|timestamp():float|replace(**kw):datetime',
    '@subprocess': 'run(args, capture_output=False, text=False, check=False, cwd=None):CompletedProcess|Popen(args):Popen|check_output(args):bytes|check_call(args):int|PIPE:int|DEVNULL:int',
    CompletedProcess: 'returncode:int|stdout:str|stderr:str|check_returncode():None',
    '@pathlib': 'Path:Path',
    Path: '+cwd():Path|+home():Path|exists():bool|is_file():bool|is_dir():bool|read_text(encoding="utf-8"):str|write_text(data, encoding="utf-8"):int|read_bytes():bytes|mkdir(parents=False, exist_ok=False):None|iterdir():iterator|glob(pattern):iterator|rglob(pattern):iterator|name:str|stem:str|suffix:str|parent:Path|resolve():Path|joinpath(*parts):Path|open(mode="r"):file|unlink():None|with_suffix(suffix):Path|relative_to(other):Path|stat():stat_result',
    '@collections': 'defaultdict(default_factory):defaultdict|Counter(iterable):Counter|deque(iterable):deque|namedtuple(typename, field_names):type|OrderedDict():OrderedDict',
    Counter: 'most_common(n=None):list|elements():iterator|update(iterable):None|total():int',
    deque: 'appendleft(x):None|popleft():T|rotate(n=1):None',
    '@itertools': 'chain(*iterables):iterator|product(*iterables, repeat=1):iterator|permutations(iterable, r=None):iterator|combinations(iterable, r):iterator|groupby(iterable, key=None):iterator|count(start=0, step=1):iterator|cycle(iterable):iterator|islice(iterable, stop):iterator|accumulate(iterable):iterator|zip_longest(*iterables):iterator',
    '@functools': 'reduce(function, iterable, initial=None):T|partial(func, *args):partial|lru_cache(maxsize=128):decorator|cache(func):decorator|wraps(wrapped):decorator',
    '@logging': 'getLogger(name=None):Logger|basicConfig(**kwargs):None|info(msg):None|debug(msg):None|warning(msg):None|error(msg):None|exception(msg):None|DEBUG:int|INFO:int|WARNING:int|ERROR:int',
    Logger: 'info(msg, *args):None|debug(msg, *args):None|warning(msg, *args):None|error(msg, *args):None|exception(msg, *args):None|setLevel(level):None|addHandler(hdlr):None',
    '@typing': 'List:type|Dict:type|Optional:type|Any:type|Union:type|Tuple:type|Callable:type|Iterable:type|TypeVar(name):TypeVar|cast(typ, val):T',
    '@shutil': 'copy(src, dst):str|copytree(src, dst):str|move(src, dst):str|rmtree(path):None|which(cmd):str|disk_usage(path):tuple',
    '@csv': 'reader(csvfile, delimiter=","):iterator|writer(csvfile, delimiter=","):writer|DictReader(f):iterator|DictWriter(f, fieldnames):writer',
    '@requests': 'get(url, params=None, **kwargs):Response|post(url, data=None, json=None, **kwargs):Response|put(url, data=None):Response|delete(url):Response|Session():Session',
    Response: 'status_code:int|text:str|json():dict|content:bytes|headers:dict|ok:bool|raise_for_status():None',
  },
  g: 'print(*values, sep=" ", end="\\n"):None|len(obj):int|range(stop):range|input(prompt=""):str|int(x=0):int|str(obj=""):str|float(x=0):float|bool(x):bool|list(iterable=()):list|dict(**kwargs):dict|set(iterable=()):set|tuple(iterable=()):tuple|open(file, mode="r", encoding=None):file|enumerate(iterable, start=0):enumerate|zip(*iterables):zip|map(function, iterable):map|filter(function, iterable):filter|sorted(iterable, key=None, reverse=False):list|reversed(seq):reversed|sum(iterable, start=0):int|min(*args, key=None):T|max(*args, key=None):T|abs(x):int|round(number, ndigits=None):int|isinstance(obj, classinfo):bool|issubclass(cls, classinfo):bool|type(obj):type|hasattr(obj, name):bool|getattr(obj, name, default=None):T|setattr(obj, name, value):None|any(iterable):bool|all(iterable):bool|super():object|id(obj):int|repr(obj):str|format(value, spec=""):str|chr(i):str|ord(c):int|divmod(a, b):tuple|pow(base, exp):int|iter(obj):iterator|next(iterator, default=None):T|vars(obj):dict|dir(obj):list|callable(obj):bool|bytes(source):bytes|exit(code=0):None|hash(obj):int|frozenset(iterable):frozenset|globals():dict|locals():dict|breakpoint():None|Exception(*args):Exception|ValueError(*args):ValueError|TypeError(*args):TypeError|KeyError(*args):KeyError|RuntimeError(*args):RuntimeError|NotImplementedError():Exception',
  tpl: [
    ['main', 'if __name__ == "__main__":\n\t${1:main()}', 'ponto de entrada'], ['def', 'def ${1:nome}($2):\n\t${0:pass}', 'função'], ['defs', 'def ${1:nome}(self$2):\n\t${0:pass}', 'método'],
    ['cls', 'class ${1:Nome}:\n\tdef __init__(self$2):\n\t\t${0:pass}', 'classe'], ['init', 'def __init__(self$1):\n\t${0:pass}', '__init__'], ['dc', '@dataclass\nclass ${1:Nome}:\n\t${2:campo}: ${3:str}', 'dataclass'],
    ['for', 'for ${1:item} in ${2:itens}:\n\t$0', 'for'], ['fori', 'for ${1:i} in range(${2:n}):\n\t$0', 'for com range'], ['fore', 'for ${1:i}, ${2:item} in enumerate(${3:itens}):\n\t$0', 'for com enumerate'],
    ['wh', 'while ${1:True}:\n\t$0', 'while'], ['try', 'try:\n\t$1\nexcept ${2:Exception} as e:\n\t$0', 'try/except'], ['with', 'with open(${1:caminho}, encoding="utf-8") as ${2:f}:\n\t$0', 'with open'],
    ['pr', 'print($0)', 'imprime'], ['prf', 'print(f"$1")', 'imprime f-string'], ['lc', '[${1:x} for ${1:x} in ${2:itens}]', 'list comprehension'], ['dcomp', '{${1:k}: ${2:v} for ${1:k}, ${2:v} in ${3:itens}}', 'dict comprehension'],
    ['ifm', 'if ${1:condicao}:\n\t$0', 'if'], ['lam', 'lambda ${1:x}: $0', 'lambda'], ['adef', 'async def ${1:nome}($2):\n\t${0:pass}', 'função async'],
  ],
  pfx: [
    ['print', 'print(EXPR)', 'imprime'], ['var', '${1:nome} = EXPR', 'cria variável'], ['if', 'if EXPR:\n\t$0', 'se verdadeiro'], ['not', 'not EXPR', 'nega'],
    ['none', 'if EXPR is None:\n\t$0', 'se None'], ['nn', 'if EXPR is not None:\n\t$0', 'se não None'], ['for', 'for ${1:item} in EXPR:\n\t$0', 'for'], ['len', 'len(EXPR)', 'tamanho'],
    ['return', 'return EXPR', 'retorna'], ['par', '(EXPR)', 'parênteses'], ['str', 'str(EXPR)', 'str'], ['list', 'list(EXPR)', 'list'], ['enum', 'enumerate(EXPR)', 'enumerate'],
  ],
};

D.php = {
  kw: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while yield true false null self parent',
  stmt: 'if foreach for while return echo function class try throw use namespace switch match',
  types: 'int float string bool array object mixed void null callable iterable',
  lit: {}, sep: ['->', '::', '?->'], newKw: true,
  T: {},
  g: 'strlen(string $string):int|str_replace(mixed $search, mixed $replace, mixed $subject):string|strpos(string $haystack, string $needle):int|str_contains(string $haystack, string $needle):bool|str_starts_with(string $haystack, string $needle):bool|str_ends_with(string $haystack, string $needle):bool|substr(string $string, int $offset, ?int $length = null):string|explode(string $separator, string $string):array|implode(string $separator, array $array):string|trim(string $string):string|strtolower(string $string):string|strtoupper(string $string):string|ucfirst(string $string):string|sprintf(string $format, mixed ...$values):string|printf(string $format, mixed ...$values):int|number_format(float $num, int $decimals = 0):string|count(array $value):int|array_push(array &$array, mixed ...$values):int|array_pop(array &$array):mixed|array_shift(array &$array):mixed|array_map(?callable $callback, array $array):array|array_filter(array $array, ?callable $callback = null):array|array_reduce(array $array, callable $callback, mixed $initial = null):mixed|array_keys(array $array):array|array_values(array $array):array|array_merge(array ...$arrays):array|array_slice(array $array, int $offset, ?int $length = null):array|array_search(mixed $needle, array $haystack):mixed|array_unique(array $array):array|array_key_exists(mixed $key, array $array):bool|in_array(mixed $needle, array $haystack):bool|sort(array &$array):bool|usort(array &$array, callable $callback):bool|ksort(array &$array):bool|json_encode(mixed $value, int $flags = 0):string|json_decode(string $json, ?bool $associative = null):mixed|isset(mixed $var):bool|empty(mixed $var):bool|unset(mixed $var):void|var_dump(mixed $value):void|print_r(mixed $value, bool $return = false):mixed|is_array(mixed $value):bool|is_string(mixed $value):bool|is_numeric(mixed $value):bool|is_null(mixed $value):bool|intval(mixed $value):int|floatval(mixed $value):float|file_get_contents(string $filename):string|file_put_contents(string $filename, mixed $data):int|file_exists(string $filename):bool|date(string $format, ?int $timestamp = null):string|time():int|preg_match(string $pattern, string $subject, array &$matches = null):int|preg_replace(string $pattern, string $replacement, string $subject):string|htmlspecialchars(string $string):string|header(string $header):void|die(string $status = ""):void|exit(string $status = ""):void|array_key_first(array $array):mixed|str_pad(string $string, int $length):string|round(int|float $num, int $precision = 0):float|max(mixed $value, mixed ...$values):mixed|min(mixed $value, mixed ...$values):mixed|abs(int|float $num):int|range(mixed $start, mixed $end):array',
  tpl: [
    ['fore', 'foreach (\\$${1:itens} as \\$${2:item}) {\n\t$0\n}', 'foreach'], ['forek', 'foreach (\\$${1:itens} as \\$${2:chave} => \\$${3:valor}) {\n\t$0\n}', 'foreach com chave'],
    ['fn', 'function ${1:nome}($2): ${3:void}\n{\n\t$0\n}', 'função'], ['pubf', 'public function ${1:nome}($2): ${3:void}\n{\n\t$0\n}', 'método público'],
    ['cls', 'class ${1:Nome}\n{\n\t$0\n}', 'classe'], ['ctor', 'public function __construct($1)\n{\n\t$0\n}', 'construtor'], ['vd', 'var_dump($0);', 'var_dump'], ['pr', 'echo $0;', 'echo'],
    ['tryc', 'try {\n\t$1\n} catch (${2:\\\\Exception} \\$e) {\n\t$0\n}', 'try/catch'], ['php', '<?php\n\n$0', 'abre PHP'],
  ],
  pfx: [],
};

D.ruby = {
  kw: 'BEGIN END alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield attr_accessor attr_reader attr_writer require require_relative private protected public',
  stmt: 'if unless while until def class module return case begin require puts',
  types: '', lit: { s: 'String', l: 'Array', d: 'Hash' }, sep: ['.'], ctorCall: false,
  ext: {},
  T: {
    String: 'length:Integer|size:Integer|upcase:String|downcase:String|capitalize:String|strip:String|chomp:String|split(pattern):Array|gsub(pattern, replacement):String|sub(pattern, replacement):String|include?(other):Boolean|start_with?(prefix):Boolean|end_with?(suffix):Boolean|chars:Array|reverse:String|to_i:Integer|to_f:Float|to_sym:Symbol|empty?:Boolean|each_char:Enumerator|lines:Array|center(width):String|ljust(width):String|index(substring):Integer|match(pattern):MatchData|scan(pattern):Array|freeze:String|format(*args):String',
    Array: 'each:Enumerator|each_with_index:Enumerator|map:Array|select:Array|reject:Array|reduce(initial):Object|first:Object|last:Object|push(obj):Array|pop:Object|shift:Object|unshift(obj):Array|include?(obj):Boolean|length:Integer|size:Integer|empty?:Boolean|sort:Array|sort_by:Array|uniq:Array|flatten:Array|join(separator):String|find:Object|group_by:Hash|min:Object|max:Object|sum:Integer|compact:Array|count:Integer|take(n):Array|drop(n):Array|each_slice(n):Enumerator|zip(other):Array|any?:Boolean|all?:Boolean|index(obj):Integer|delete(obj):Object|sample:Object|shuffle:Array|reverse:Array',
    Hash: 'each:Enumerator|each_pair:Enumerator|keys:Array|values:Array|fetch(key, default):Object|key?(key):Boolean|dig(*keys):Object|merge(other):Hash|select:Hash|reject:Hash|map:Array|to_a:Array|delete(key):Object|include?(key):Boolean|empty?:Boolean|size:Integer|transform_values:Hash|group_by:Hash|sort_by:Array|any?:Boolean|count:Integer',
  },
  g: 'puts(*objects):nil|p(*objects):Object|print(*objects):nil|gets:String|require(name):Boolean|require_relative(path):Boolean|raise(exception):nil|loop:nil|format(fmt, *args):String|sleep(seconds):Integer|rand(max):Integer|lambda:Proc|proc:Proc|attr_accessor(*names)|attr_reader(*names)',
  tpl: [
    ['def', 'def ${1:nome}($2)\n\t$0\nend', 'método'], ['cls', 'class ${1:Nome}\n\tdef initialize($2)\n\t\t$0\n\tend\nend', 'classe'], ['each', '${1:itens}.each do |${2:item}|\n\t$0\nend', 'each'],
    ['eachi', '${1:itens}.each_with_index do |${2:item}, ${3:i}|\n\t$0\nend', 'each com índice'], ['if', 'if ${1:condicao}\n\t$0\nend', 'if'], ['pu', 'puts $0', 'puts'], ['beg', 'begin\n\t$1\nrescue ${2:StandardError} => e\n\t$0\nend', 'begin/rescue'],
    ['mod', 'module ${1:Nome}\n\t$0\nend', 'module'], ['map', '${1:itens}.map { |${2:x}| $0 }', 'map'],
  ],
  pfx: [['puts', 'puts EXPR', 'imprime'], ['p', 'p EXPR', 'inspeciona'], ['if', 'if EXPR\n\t$0\nend', 'se verdadeiro'], ['each', 'EXPR.each do |${1:item}|\n\t$0\nend', 'each'], ['var', '${1:nome} = EXPR', 'cria variável']],
};

const C_G = 'printf(const char *format, ...):int|scanf(const char *format, ...):int|puts(const char *s):int|putchar(int c):int|getchar():int|fopen(const char *path, const char *mode):FILE*|fclose(FILE *stream):int|fprintf(FILE *stream, const char *format, ...):int|fscanf(FILE *stream, const char *format, ...):int|fgets(char *s, int size, FILE *stream):char*|fputs(const char *s, FILE *stream):int|fread(void *ptr, size_t size, size_t n, FILE *stream):size_t|fwrite(const void *ptr, size_t size, size_t n, FILE *stream):size_t|sprintf(char *str, const char *format, ...):int|snprintf(char *str, size_t size, const char *format, ...):int|malloc(size_t size):void*|calloc(size_t n, size_t size):void*|realloc(void *ptr, size_t size):void*|free(void *ptr):void|strlen(const char *s):size_t|strcpy(char *dest, const char *src):char*|strncpy(char *dest, const char *src, size_t n):char*|strcmp(const char *a, const char *b):int|strncmp(const char *a, const char *b, size_t n):int|strcat(char *dest, const char *src):char*|strchr(const char *s, int c):char*|strstr(const char *haystack, const char *needle):char*|strtok(char *str, const char *delim):char*|memcpy(void *dest, const void *src, size_t n):void*|memset(void *s, int c, size_t n):void*|memcmp(const void *a, const void *b, size_t n):int|exit(int status):void|atoi(const char *s):int|atof(const char *s):double|strtol(const char *s, char **end, int base):long|abs(int n):int|sqrt(double x):double|pow(double x, double y):double|floor(double x):double|ceil(double x):double|rand():int|srand(unsigned seed):void|time(time_t *t):time_t|qsort(void *base, size_t n, size_t size, int (*cmp)(const void *, const void *)):void|isdigit(int c):int|isalpha(int c):int|isspace(int c):int|toupper(int c):int|tolower(int c):int|assert(int expr):void|NULL:void*|EOF:int|stdin:FILE*|stdout:FILE*|stderr:FILE*|EXIT_SUCCESS:int|EXIT_FAILURE:int|sizeof(type):size_t';
const C_KW = 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL';
const C_TPL = [
  ['main', 'int main(int argc, char *argv[]) {\n\t$0\n\treturn 0;\n}', 'função main'], ['pf', 'printf("$1\\n"$2);', 'printf'], ['fori', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for com índice'],
  ['inc', '#include <${1:stdio.h}>', '#include'], ['incl', '#include "${1:arquivo.h}"', '#include local'], ['if', 'if (${1:condicao}) {\n\t$0\n}', 'if'], ['wh', 'while (${1:condicao}) {\n\t$0\n}', 'while'],
  ['st', 'typedef struct {\n\t$0\n} ${1:Nome};', 'struct'], ['sw', 'switch (${1:x}) {\ncase ${2:valor}:\n\t$0\n\tbreak;\ndefault:\n\tbreak;\n}', 'switch'], ['guard', '#ifndef ${1:NOME_H}\n#define ${1:NOME_H}\n\n$0\n\n#endif', 'include guard'],
];
const C_PFX = [['if', 'if (EXPR) {\n\t$0\n}', 'se verdadeiro'], ['not', '!EXPR', 'nega'], ['null', 'if (EXPR == NULL) {\n\t$0\n}', 'se NULL'], ['nn', 'if (EXPR != NULL) {\n\t$0\n}', 'se não NULL'], ['return', 'return EXPR;', 'retorna'], ['par', '(EXPR)', 'parênteses'], ['fori', 'for (int ${1:i} = 0; ${1:i} < EXPR; ${1:i}++) {\n\t$0\n}', 'for até o valor']];
D.c = { kw: C_KW, stmt: 'if for while do switch return struct typedef', types: 'int char long short float double void unsigned signed size_t bool FILE', lit: {}, sep: ['.', '->'], T: {}, g: C_G, tpl: C_TPL, pfx: C_PFX };

D.cpp = {
  kw: C_KW + ' class namespace template typename public private protected virtual override final new delete this using try catch throw nullptr constexpr noexcept operator friend explicit mutable static_cast dynamic_cast reinterpret_cast const_cast auto decltype co_await co_return',
  stmt: 'if for while do switch return class struct namespace template using try throw auto',
  types: 'int char long short float double void unsigned bool auto size_t string vector map',
  lit: {}, sep: ['.', '->', '::'], newKw: true,
  ext: { unordered_map: 'map', multimap: 'map', unordered_set: 'set', deque: 'vector', array: 'vector' },
  T: {
    '@std': 'cout:ostream|cin:istream|cerr:ostream|endl:ostream|string:string|vector:vector|map:map|unordered_map:map|set:set|unordered_set:set|pair:pair|optional:optional|make_pair(T1 a, T2 b):pair|make_unique(Args... args):unique_ptr|make_shared(Args... args):shared_ptr|sort(first, last):void|reverse(first, last):void|find(first, last, value):iterator|max(a, b):T|min(a, b):T|swap(a, b):void|move(t):T|to_string(value):string|stoi(const string &str):int|stol(const string &str):long|stod(const string &str):double|getline(istream &is, string &str):istream|accumulate(first, last, init):T|count(first, last, value):size_t|abs(x):T|unique_ptr:unique_ptr|shared_ptr:shared_ptr|thread:thread|mutex:mutex|function:function|array:array|deque:deque|tuple:tuple|begin(c):iterator|end(c):iterator|size(c):size_t|filesystem:@std::filesystem|chrono:@std::chrono',
    vector: 'push_back(const T &value):void|emplace_back(Args&&... args):T&|pop_back():void|size():size_t|empty():bool|clear():void|begin():iterator|end():iterator|at(size_t pos):T&|front():T&|back():T&|insert(iterator pos, const T &value):iterator|erase(iterator pos):iterator|reserve(size_t n):void|resize(size_t n):void|data():T*|capacity():size_t|rbegin():iterator|rend():iterator',
    string: 'length():size_t|size():size_t|substr(size_t pos, size_t len):string|find(const string &str):size_t|rfind(const string &str):size_t|c_str():const char*|append(const string &str):string&|push_back(char c):void|pop_back():void|empty():bool|replace(size_t pos, size_t len, const string &str):string&|compare(const string &str):int|at(size_t pos):char&|begin():iterator|end():iterator|erase(size_t pos, size_t len):string&|insert(size_t pos, const string &str):string&|clear():void|starts_with(const string &s):bool|ends_with(const string &s):bool|contains(const string &s):bool|front():char&|back():char&',
    map: 'insert(const pair &value):pair|emplace(Args&&... args):pair|find(const K &key):iterator|count(const K &key):size_t|contains(const K &key):bool|erase(const K &key):size_t|size():size_t|empty():bool|clear():void|begin():iterator|end():iterator|at(const K &key):V&|try_emplace(const K &key, Args&&... args):pair',
    set: 'insert(const T &value):pair|find(const T &value):iterator|count(const T &value):size_t|contains(const T &value):bool|erase(const T &value):size_t|size():size_t|empty():bool|clear():void|begin():iterator|end():iterator',
    pair: 'first:T1|second:T2', optional: 'has_value():bool|value():T&|value_or(T default_value):T|reset():void',
    unique_ptr: 'get():T*|reset(T *p):void|release():T*', shared_ptr: 'get():T*|reset(T *p):void|use_count():long',
    ostream: 'flush():ostream&|write(const char *s, size_t n):ostream&', istream: 'get():int|ignore():istream&|getline(char *s, size_t n):istream&|eof():bool|fail():bool',
    thread: 'join():void|detach():void|joinable():bool', mutex: 'lock():void|unlock():void|try_lock():bool',
  },
  g: C_G,
  tpl: [
    ['main', 'int main() {\n\t$0\n\treturn 0;\n}', 'função main'], ['cout', 'std::cout << $1 << std::endl;', 'imprime'], ['cin', 'std::cin >> $1;', 'lê'],
    ['forr', 'for (const auto &${1:item} : ${2:itens}) {\n\t$0\n}', 'for range'], ['fori', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for com índice'],
    ['inc', '#include <${1:iostream}>', '#include'], ['cls', 'class ${1:Nome} {\npublic:\n\t${1:Nome}();\n\t$0\n};', 'classe'], ['ns', 'namespace ${1:nome} {\n\n$0\n\n}', 'namespace'],
    ['uns', 'using namespace std;', 'using namespace std'], ['tryc', 'try {\n\t$1\n} catch (const std::exception &e) {\n\t$0\n}', 'try/catch'], ['lam', '[${1:&}](${2}) { $0 }', 'lambda'],
  ],
  pfx: [['cout', 'std::cout << EXPR << std::endl;', 'imprime'], ['var', 'auto ${1:nome} = EXPR;', 'cria variável'], ...C_PFX, ['forr', 'for (const auto &${1:item} : EXPR) {\n\t$0\n}', 'for range']],
};

const JS_TPL = [
  ['log', 'console.log($0);', 'console.log'], ['logv', 'console.log("${1:valor}:", ${1:valor});', 'log com nome'], ['err', 'console.error($0);', 'console.error'],
  ['fori', 'for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n\t$0\n}', 'for com índice'], ['forof', 'for (const ${1:item} of ${2:itens}) {\n\t$0\n}', 'for...of'],
  ['forin', 'for (const ${1:chave} in ${2:objeto}) {\n\t$0\n}', 'for...in'], ['fn', 'function ${1:nome}($2) {\n\t$0\n}', 'função'], ['afn', 'const ${1:nome} = ($2) => {\n\t$0\n};', 'arrow function'],
  ['asf', 'async function ${1:nome}($2) {\n\t$0\n}', 'função async'], ['imp', "import { $2 } from '${1:modulo}';", 'import'], ['imd', "import ${2:nome} from '${1:modulo}';", 'import default'],
  ['req', "const ${1:nome} = require('${2:modulo}');", 'require'], ['cls', 'class ${1:Nome} {\n\tconstructor($2) {\n\t\t$0\n\t}\n}', 'classe'], ['tryc', 'try {\n\t$1\n} catch (e) {\n\t$0\n}', 'try/catch'],
  ['iife', '(() => {\n\t$0\n})();', 'IIFE'], ['prom', 'new Promise((resolve, reject) => {\n\t$0\n})', 'Promise'], ['st', 'setTimeout(() => {\n\t$0\n}, ${1:1000});', 'setTimeout'],
  ['ael', "${1:el}.addEventListener('${2:click}', (e) => {\n\t$0\n});", 'addEventListener'], ['qs', "document.querySelector('${1:seletor}')", 'querySelector'], ['exp', 'export ', 'export'],
];
const JS_PFX = [
  ['log', 'console.log(EXPR)', 'imprime'], ['const', 'const ${1:nome} = EXPR;', 'cria const'], ['let', 'let ${1:nome} = EXPR;', 'cria let'], ['if', 'if (EXPR) {\n\t$0\n}', 'se verdadeiro'],
  ['not', '!EXPR', 'nega'], ['null', 'if (EXPR == null) {\n\t$0\n}', 'se null'], ['nn', 'if (EXPR != null) {\n\t$0\n}', 'se não null'], ['for', 'for (const ${1:item} of EXPR) {\n\t$0\n}', 'for...of'],
  ['return', 'return EXPR;', 'retorna'], ['await', 'await EXPR', 'await'], ['par', '(EXPR)', 'parênteses'], ['json', 'JSON.stringify(EXPR)', 'JSON'], ['spread', '...EXPR', 'spread'], ['arr', '[EXPR]', 'array'],
];
// JS/TS: o worker do TypeScript já sabe os membros; aqui entram só templates e postfix
D.javascript = { only: 'templates', tpl: JS_TPL, pfx: JS_PFX, sep: ['.'] };
D.typescript = { only: 'templates', tpl: [...JS_TPL, ['intf', 'interface ${1:Nome} {\n\t$0\n}', 'interface'], ['typ', 'type ${1:Nome} = $0;', 'type']], pfx: [...JS_PFX, ['as', '(EXPR as ${1:Tipo})', 'as']], sep: ['.'] };

D.sql = {
  kw: 'SELECT FROM WHERE AND OR NOT IN IS NULL LIKE BETWEEN EXISTS ORDER BY GROUP HAVING LIMIT OFFSET JOIN INNER LEFT RIGHT FULL OUTER CROSS ON AS DISTINCT UNION ALL INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE VIEW INDEX DROP ALTER ADD COLUMN PRIMARY KEY FOREIGN REFERENCES UNIQUE DEFAULT CHECK CONSTRAINT CASE WHEN THEN ELSE END ASC DESC WITH RETURNING TRUNCATE BEGIN COMMIT ROLLBACK TRANSACTION GRANT REVOKE IF REPLACE CASCADE SCHEMA DATABASE',
  stmt: 'SELECT INSERT UPDATE DELETE CREATE DROP ALTER WITH BEGIN COMMIT', upper: true,
  types: 'INT INTEGER BIGINT SMALLINT DECIMAL NUMERIC FLOAT REAL DOUBLE VARCHAR CHAR TEXT DATE TIME TIMESTAMP BOOLEAN BLOB JSON UUID SERIAL',
  lit: {}, sep: ['.'], T: {},
  g: 'COUNT(expr):INT|SUM(expr):NUMERIC|AVG(expr):NUMERIC|MIN(expr)|MAX(expr)|COALESCE(value, ...)|NULLIF(a, b)|CAST(expr AS type)|CONCAT(str, ...):TEXT|UPPER(str):TEXT|LOWER(str):TEXT|TRIM(str):TEXT|SUBSTRING(str, start, length):TEXT|LENGTH(str):INT|REPLACE(str, from, to):TEXT|ROUND(n, d):NUMERIC|ABS(n)|NOW():TIMESTAMP|CURRENT_DATE:DATE|CURRENT_TIMESTAMP:TIMESTAMP|DATE(expr):DATE|EXTRACT(field FROM source)|ROW_NUMBER() OVER (...)|RANK() OVER (...)|STRING_AGG(expr, sep)|GROUP_CONCAT(expr)',
  tpl: [
    ['sel', 'SELECT ${1:*}\nFROM ${2:tabela}\nWHERE $0;', 'SELECT'], ['selc', 'SELECT COUNT(*)\nFROM ${1:tabela}\nWHERE $0;', 'SELECT COUNT'], ['ins', 'INSERT INTO ${1:tabela} (${2:colunas})\nVALUES ($0);', 'INSERT'],
    ['upd', 'UPDATE ${1:tabela}\nSET ${2:coluna} = ${3:valor}\nWHERE $0;', 'UPDATE'], ['del', 'DELETE FROM ${1:tabela}\nWHERE $0;', 'DELETE'], ['ct', 'CREATE TABLE ${1:tabela} (\n\tid ${2:SERIAL} PRIMARY KEY,\n\t$0\n);', 'CREATE TABLE'],
    ['join', 'JOIN ${1:tabela} ${2:t} ON ${2:t}.${3:id} = $0', 'JOIN'], ['lj', 'LEFT JOIN ${1:tabela} ${2:t} ON ${2:t}.${3:id} = $0', 'LEFT JOIN'], ['cte', 'WITH ${1:nome} AS (\n\t$2\n)\nSELECT * FROM ${1:nome}$0;', 'CTE'],
  ],
  pfx: [],
};
D.mysql = D.sql; D.pgsql = D.sql;

D.shell = {
  kw: 'if then else elif fi for in do done while until case esac function return local export readonly declare unset shift exit break continue select time',
  stmt: 'if for while case function local export echo return',
  types: '', lit: {}, sep: [], T: {},
  g: 'echo|printf|read|cd|pwd|ls|cp|mv|rm|mkdir|rmdir|touch|cat|less|head|tail|grep|sed|awk|find|xargs|sort|uniq|wc|cut|tr|tee|chmod|chown|ln|tar|zip|unzip|curl|wget|ssh|scp|rsync|git|docker|kubectl|npm|node|python3|pip|make|sudo|source|test|basename|dirname|date|sleep|kill|ps|env|which|jq|xargs|trap|set|eval|exec|mktemp|realpath|seq|diff',
  tpl: [
    ['sb', '#!/usr/bin/env bash\nset -euo pipefail\n\n$0', 'shebang'], ['if', 'if [[ ${1:condicao} ]]; then\n\t$0\nfi', 'if'], ['ife', 'if [[ ${1:condicao} ]]; then\n\t$2\nelse\n\t$0\nfi', 'if/else'],
    ['for', 'for ${1:item} in ${2:itens}; do\n\t$0\ndone', 'for'], ['fori', 'for ((${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++)); do\n\t$0\ndone', 'for com índice'], ['wh', 'while ${1:condicao}; do\n\t$0\ndone', 'while'],
    ['fn', '${1:nome}() {\n\t$0\n}', 'função'], ['case', 'case "\\$${1:var}" in\n\t${2:padrao})\n\t\t$0\n\t\t;;\n\t*)\n\t\t;;\nesac', 'case'], ['rl', 'while IFS= read -r ${1:linha}; do\n\t$0\ndone < "${2:arquivo}"', 'lê linhas'],
  ],
  pfx: [],
};
D.powershell = {
  kw: 'begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function hidden if in param process return static switch throw trap try until using var while $true $false $null',
  stmt: 'if foreach for while function param try return switch',
  types: '[string] [int] [bool] [array] [hashtable] [datetime] [double] [object]', lit: {}, sep: ['.'], T: {},
  g: 'Get-ChildItem|Get-Content|Set-Content|Add-Content|Out-File|Write-Host|Write-Output|Write-Error|Write-Warning|Write-Verbose|Read-Host|Get-Process|Stop-Process|Start-Process|Get-Service|Start-Service|Stop-Service|Test-Path|New-Item|Remove-Item|Copy-Item|Move-Item|Rename-Item|Get-Item|Set-Location|Get-Location|Join-Path|Split-Path|Resolve-Path|Invoke-WebRequest|Invoke-RestMethod|ConvertTo-Json|ConvertFrom-Json|ConvertTo-Csv|Import-Csv|Export-Csv|Select-Object|Where-Object|ForEach-Object|Sort-Object|Group-Object|Measure-Object|Select-String|Get-Date|Start-Sleep|Import-Module|Get-Command|Get-Help|Get-Member|New-Object|Format-Table|Format-List|Out-String|Get-Variable|Set-Variable|Invoke-Expression|Invoke-Command|Get-Credential|Expand-Archive|Compress-Archive|Get-FileHash|Get-Clipboard|Set-Clipboard',
  tpl: [
    ['fn', 'function ${1:Verbo-Nome} {\n\tparam(\n\t\t[${2:string}]\\$${3:Parametro}\n\t)\n\t$0\n}', 'função'], ['if', 'if (${1:condicao}) {\n\t$0\n}', 'if'],
    ['fore', 'foreach (\\$${1:item} in \\$${2:itens}) {\n\t$0\n}', 'foreach'], ['tryc', 'try {\n\t$1\n} catch {\n\t$0\n}', 'try/catch'], ['param', 'param(\n\t[${1:string}]\\$${2:Nome}\n)', 'param'],
  ],
  pfx: [],
};
D.lua = {
  kw: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while',
  stmt: 'if for while local function return repeat', types: '', lit: { s: '@string' }, sep: ['.', ':'], T: {
    '@string': 'format(fmt, ...):string|sub(s, i, j):string|len(s):number|upper(s):string|lower(s):string|find(s, pattern):number|gsub(s, pattern, repl):string|match(s, pattern):string|gmatch(s, pattern):function|rep(s, n):string|reverse(s):string|byte(s, i):number|char(...):string',
    '@table': 'insert(t, value)|remove(t, pos):any|concat(t, sep):string|sort(t, comp)|unpack(t):...|pack(...):table',
    '@math': 'floor(x):number|ceil(x):number|abs(x):number|max(x, ...):number|min(x, ...):number|sqrt(x):number|random(m, n):number|randomseed(x)|huge:number|pi:number|tointeger(x):number',
    '@io': 'write(...)|read(format):string|open(filename, mode):file|lines(filename):function|close(file)',
    '@os': 'time():number|date(format):string|clock():number|getenv(name):string|execute(command)|exit(code)|remove(filename)|rename(old, new)',
  },
  g: 'print(...)|pairs(t):function|ipairs(t):function|require(modname):any|tostring(v):string|tonumber(v):number|type(v):string|pcall(f, ...):boolean|error(message)|assert(v, message)|setmetatable(t, mt):table|getmetatable(t):table|select(n, ...):any|next(t, k):any|rawget(t, k):any',
  tpl: [['fn', 'function ${1:nome}($2)\n\t$0\nend', 'função'], ['lfn', 'local function ${1:nome}($2)\n\t$0\nend', 'função local'], ['for', 'for ${1:i} = ${2:1}, ${3:n} do\n\t$0\nend', 'for numérico'],
    ['forp', 'for ${1:k}, ${2:v} in pairs(${3:t}) do\n\t$0\nend', 'for pairs'], ['fori', 'for ${1:i}, ${2:v} in ipairs(${3:t}) do\n\t$0\nend', 'for ipairs'], ['if', 'if ${1:condicao} then\n\t$0\nend', 'if']],
  pfx: [],
};

window.BS_CMPL = D;
})();
