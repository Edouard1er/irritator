// Preflight contracts over JSON identities, before project allocation or initialize.
// Parameter/port/source constraints come from the same catalogue as TypeScript.
struct structural_validator {
    const D& doc; const D& catalog;
    struct context { std::string prefix, definition; };
    std::map<std::string,const V*> defs;
    std::set<std::string> done;
    struct leaf { const V* component; context ctx; int port; };
    explicit structural_validator(const D& d,const D& c):doc(d),catalog(c) {}
    [[noreturn]] void reject(const char* code,const char* legacy,const std::string& message,const context& ctx,const std::string& instance,const V& found,const std::string& expected,const char* parameter=nullptr,const V* connection=nullptr) const {
        D diagnostics(rapidjson::kArrayType); auto& a=diagnostics.GetAllocator(); V item(rapidjson::kObjectType);
        auto add=[&](const char* key,const std::string& value){item.AddMember(V(key,a),V(value.c_str(),a),a);};
        add("code",code); add("severity","error"); add("path",ctx.prefix+instance); add("instance",instance);
        if(ctx.definition.empty()) item.AddMember("definition",V(),a); else add("definition",ctx.definition);
        item.AddMember("connection",connection?V(*connection,a):V(),a);
        if(parameter) add("parameter",parameter); else item.AddMember("parameter",V(),a);
        item.AddMember("found",V(found,a),a); add("expected",expected); add("message",message); diagnostics.PushBack(item,a);
        rapidjson::StringBuffer buffer; rapidjson::Writer<rapidjson::StringBuffer> writer(buffer); diagnostics.Accept(writer);
        failure error(legacy,ctx.prefix+instance+": "+message); error.diagnostics=buffer.GetString(); throw error;
    }
    const V& definition(const std::string& id,const context& ctx,const V& owner) const {
        auto it=defs.find(id); if(it==defs.end()) reject("DEFINITION_NOT_FOUND","DEFINITION_NOT_FOUND","Referenced definition does not exist",ctx,str(owner["id"]),owner.HasMember("definition")?owner["definition"]:owner["experiment"]["definition"],"declared coupled definition","definition"); return *it->second;
    }
    const V& target(const V& scope,const std::string& path,const context& ctx,const V& owner,const std::string& parameter,const char* legacy) const {
        const V* s=&scope; std::size_t begin=0;
        while(true) {
            const auto end=path.find('/',begin);const auto name=path.substr(begin,end==path.npos?end:end-begin); const V* child=nullptr;
            for(const auto& c:(*s)["components"].GetArray()) if(str(c["id"])==name) {child=&c;break;}
            if(!child || (end!=path.npos && str((*child)["type"])!="coupled")) {V found(path.c_str(),static_cast<rapidjson::SizeType>(path.size()));reject("TARGET_NOT_FOUND",legacy,"Target path does not resolve to a component",ctx,str(owner["id"]),found,"existing atomic instance path",parameter.c_str());}
            if(end==path.npos) return *child;
            s=&definition(str((*child)["definition"]),ctx,*child);begin=end+1;
        }
    }
    const V* spec(const std::string& type) const {for(const auto& c:catalog["components"].GetArray())if(str(c["type"])==type)return &c;return nullptr;}
    static std::string number_text(const V& n) {rapidjson::StringBuffer b;rapidjson::Writer<rapidjson::StringBuffer> w(b);n.Accept(w);return b.GetString();}
    bool has_port(const V& ports,int port) const {for(const auto& p:ports.GetArray())if(p["port"].GetInt()==port)return true;return false;}
    bool contains_wrapper(const V& scope,std::set<std::string>& visited) const {
        for(const auto& c:scope["components"].GetArray()) {
            if(str(c["type"])=="simulation_wrapper")return true;
            if(str(c["type"])=="coupled"&&visited.insert(str(c["definition"])).second&&contains_wrapper(*defs.at(str(c["definition"])),visited))return true;
        }
        return false;
    }
    void dependencies(const V& scope,const context& ctx,std::set<std::string>& active,std::set<std::string>& finished) const {
        for(const auto& c:scope["components"].GetArray()) {
            const auto type=str(c["type"]);if(type!="coupled"&&type!="simulation_wrapper")continue;
            const auto& ref=type=="coupled"?c["definition"]:c["experiment"]["definition"];const auto id=str(ref);
            if(active.contains(id))reject("RECURSIVE_DEFINITION","RECURSIVE_DEFINITION","Recursive coupled/prospective definition",ctx,str(c["id"]),ref,"acyclic definition dependencies","definition");
            if(finished.contains(id))continue;
            active.insert(id);
            if(active.size()>16){V depth(static_cast<unsigned>(active.size()));reject("HIERARCHY_DEPTH","HIERARCHY_DEPTH","Combined dependency depth exceeds 16",ctx,str(c["id"]),depth,"combined definition dependency depth <= 16","definition");}
            dependencies(definition(id,ctx,c),{"@"+id+"/",id},active,finished);active.erase(id);finished.insert(id);
        }
    }
    void local(const V& scope,const context& ctx,bool experiments=true) const {
        std::set<std::string> ids;
        for(const auto& c:scope["components"].GetArray()) {
            const auto id=str(c["id"]),type=str(c["type"]);
            if(!ids.insert(id).second) reject("DUPLICATE_INSTANCE","INVALID_MODEL","Component identifiers must be unique in their scope",ctx,id,c["id"],"unique local id");
            if(type=="coupled") {(void)definition(str(c["definition"]),ctx,c);continue;}
            if(type=="simulation_wrapper" && doc["schemaVersion"].GetInt()==3) {
                const auto& e=c["experiment"];const auto& d=definition(str(e["definition"]),ctx,c);
                if(!experiments)continue;
                const auto f=e["factors"].Size(),count=e["selections"].Size();
                if(f<1||f>10||count<1||f+count<3||f+count>12) {V found(f+count);reject("WRAPPER_DIMENSIONS","INVALID_EXPERIMENT","Native wrapper dimensions require 1<=F<=10, S>=1, 3<=F+S<=12",ctx,id,found,"1<=F<=10, S>=1, 3<=F+S<=12","experiment");}
                std::set<std::string> visited;
                if(contains_wrapper(d,visited))reject("WRAPPER_NESTING","UNSUPPORTED_EXPERIMENT","Prospective wrappers are outside the validated single-level domain",ctx,id,e["definition"],"wrapper nesting <= 1","definition");
                for(const auto& f:e["factors"].GetArray()) {
                    const auto& atom=target(d,str(f["target"]),ctx,c,"factors."+str(f["id"])+".target","INVALID_FACTOR");
                    const auto at=str(atom["type"]),param=str(f["parameter"]);
                    if(!((at=="constant"&&param=="value")||((at=="qss1_integrator"||at=="qss2_integrator"||at=="qss3_integrator")&&param=="X"))) reject("FACTOR_PARAMETER","INVALID_FACTOR","Factor parameter has no supported native reals[0] binding",ctx,id,f["parameter"],"constant.value or QSS integrator.X",("factors."+str(f["id"])+".parameter").c_str());
                }
                std::set<std::string> selections;
                for(const auto& s:e["selections"].GetArray()) {
                    selections.insert(str(s["id"])); const auto& atom=target(d,str(s["target"]),ctx,c,"selections."+str(s["id"])+".target","INVALID_SELECTION");
                    if(!spec(str(atom["type"]))) reject("SELECTION_TARGET","INVALID_SELECTION","Selection requires an observable catalogue atom",ctx,id,s["target"],"observable atomic path",("selections."+str(s["id"])+".target").c_str());
                }
                const auto& o=e["objective"];
                if(str(o["method"])!="weighted-sum"&&!selections.contains(str(o["primary"]))) reject("OBJECTIVE_CRITERION","INVALID_SELECTION","Objective primary does not name a declared selection",ctx,id,o["primary"],"declared selection id","objective.primary");
                if(e.HasMember("execution")&&(str(e["run"])!="complete"||!e.HasMember("scenarioResults")||!e["scenarioResults"].GetBool())) reject("WRAPPER_EXECUTION","INVALID_EXPERIMENT","Execution control requires complete mode and scenarioResults",ctx,id,e["run"],"complete with scenarioResults","execution");
                continue;
            }
            const auto* desc=spec(type);
            if(!desc)reject("UNKNOWN_COMPONENT","UNKNOWN_COMPONENT","Atomic type is absent from the executable catalogue",ctx,id,c["type"],"catalogue atomic type");
            const auto& params=c["parameters"];
            for(const auto& key:(*desc)["required"].GetArray())if(!params.HasMember(key.GetString()))reject("PARAMETER_REQUIRED","INVALID_PARAMETER","Required atomic parameter is missing",ctx,id,V(),"required parameter",key.GetString());
            for(auto p=params.MemberBegin();p!=params.MemberEnd();++p) {
                const auto& bounds=(*desc)["parameters"];bool valid=bounds.HasMember(p->name);
                if(valid){const auto& b=bounds[p->name];const auto n=p->value.GetDouble();valid=std::isfinite(n)&&n>=b["minimum"].GetDouble()&&n<=b["maximum"].GetDouble()&&(str(b["type"])!="integer"||std::floor(n)==n);}
                if(!valid) {const auto expected=bounds.HasMember(p->name)?str(bounds[p->name]["type"])+" in ["+number_text(bounds[p->name]["minimum"])+","+number_text(bounds[p->name]["maximum"])+"]":"declared parameter";reject("PARAMETER_DOMAIN","INVALID_PARAMETER","Parameter violates the executable catalogue domain",ctx,id,p->value,expected,p->name.GetString());}
            }
        }
        if(!experiments)return;
        for(const auto& edge:scope["connections"].GetArray()) for(const bool output:{true,false}) {
            const auto& ep=edge[output?"from":"to"];const auto id=str(ep["component"]);const auto port=ep["port"].GetInt();
            if(id.starts_with('$')) {
                if(ctx.definition.empty()||id!=(output?"$input":"$output")||!has_port((*defs.at(ctx.definition))[output?"inputs":"outputs"],port))reject("CONNECTION_DIRECTION","INVALID_EXTERNAL_PORT","Endpoint violates the coupled interface direction or port contract",ctx,id,ep,"source output to destination input",nullptr,&edge);
            } else {
                const V* c=nullptr;for(const auto& candidate:scope["components"].GetArray())if(str(candidate["id"])==id){c=&candidate;break;}
                if(!c)reject("CONNECTION_REFERENCE",doc["schemaVersion"].GetInt()==1?"INVALID_REFERENCE":"INVALID_SCOPE","Connection endpoint is outside its local scope",ctx,id,ep,"existing local component",nullptr,&edge);
                const auto type=str((*c)["type"]);bool valid=false;
                if(type=="simulation_wrapper" && c->HasMember("experiment")) {const auto& e=(*c)["experiment"];const auto f=e["factors"].Size(),s=e["selections"].Size();const int n=(output?(e.HasMember("scenarioResults")&&e["scenarioResults"].GetBool()?2*(f+s)+2:f+s):f+2)+(e.HasMember("dynamicPlan")&&e["dynamicPlan"].GetBool()?1:0)+(output&&e.HasMember("execution")?5:0);valid=port>=0&&port<n;}
                else {const auto& desc=type=="coupled"?definition(str((*c)["definition"]),ctx,*c):*spec(type);valid=has_port(desc[output?"outputs":"inputs"],port);}
                if(!valid)reject("CONNECTION_PORT","INVALID_CONNECTION","Port is absent in the required direction",ctx,id,ep,output?"outputs port":"inputs port",nullptr,&edge);
            }
        }
    }
    std::vector<leaf> endpoints(const V& scope,const V& ep,bool output,const context& ctx,int depth=0) const {
        std::vector<leaf> result;const auto id=str(ep["component"]);if(id.starts_with('$')||depth>16)return result;
        const V* c=nullptr;for(const auto& candidate:scope["components"].GetArray())if(str(candidate["id"])==id){c=&candidate;break;}
        if(str((*c)["type"])!="coupled")return {{c,ctx,ep["port"].GetInt()}};
        const auto& d=definition(str((*c)["definition"]),ctx,*c);context sub{ctx.prefix+id+"/",str(d["id"])};
        for(const auto& e:d["connections"].GetArray()) {const auto& external=e[output?"to":"from"];if(str(external["component"])==(output?"$output":"$input")&&external["port"].GetInt()==ep["port"].GetInt()){auto nested=endpoints(d,e[output?"from":"to"],output,sub,depth+1);result.insert(result.end(),nested.begin(),nested.end());}}
        return result;
    }
    void graph(const V& scope,const context& ctx,std::set<std::string> stack,std::map<std::string,int>& bindings) {
        if(stack.size()>16)return;
        if(!ctx.definition.empty()){if(!stack.insert(ctx.definition).second)return;done.insert(ctx.definition);}
        for(const auto& e:scope["connections"].GetArray()) {
            auto from=endpoints(scope,e["from"],true,ctx),to=endpoints(scope,e["to"],false,ctx);
            for(const auto& dst:to) {
                const auto* desc=spec(str((*dst.component)["type"]));if(!desc||!desc->HasMember("sourceContracts"))continue;
                for(const auto& rule:(*desc)["sourceContracts"].GetArray())if(dst.port==rule["port"].GetInt())for(const auto& src:from) {
                    bool supported=false;std::string expected;
                    for(const auto& type:rule["types"].GetArray()){if(!expected.empty())expected+='|';expected+=str(type);if(str(type)==str((*src.component)["type"]))supported=true;}
                    const auto id=str((*dst.component)["id"]);
                    if(!supported)reject("STATE_OBSERVER_SOURCE_TYPE","STRUCTURAL_INCOMPATIBILITY","Source binding requires a compatible native continuous-state integrator",dst.ctx,id,(*src.component)["type"],expected,"source",&e);
                    const auto n=++bindings[dst.ctx.prefix+id];if(n>rule["maximum"].GetInt()) {V found(n);reject("STATE_OBSERVER_SOURCE_COUNT","STRUCTURAL_INCOMPATIBILITY","Source binding is ambiguous",dst.ctx,id,found,"at most "+std::to_string(rule["maximum"].GetInt())+" source binding","source",&e);}
                }
            }
        }
        for(const auto& c:scope["components"].GetArray()) {
            const auto type=str(c["type"]),id=str(c["id"]);
            if(type=="coupled")graph(definition(str(c["definition"]),ctx,c),{ctx.prefix+id+"/",str(c["definition"])},stack,bindings);
            else if(c.HasMember("experiment")){const auto def=str(c["experiment"]["definition"]);std::map<std::string,int> child;graph(definition(def,ctx,c),{ctx.prefix+id+"/@"+def+"/",def},stack,child);}
        }
    }
    void run() {
        if(doc["model"].HasMember("definitions"))for(const auto& d:doc["model"]["definitions"].GetArray())if(!defs.emplace(str(d["id"]),&d).second)reject("DUPLICATE_DEFINITION","INVALID_MODEL","Definition identifiers must be unique",{},"",d["id"],"unique definition id");
        if(doc["model"].HasMember("definitions"))for(const auto& d:doc["model"]["definitions"].GetArray())for(const auto dir:{"inputs","outputs"}) {
            const auto id=str(d["id"]);
            std::set<int> ports;std::set<std::string> names;
            for(const auto& p:d[dir].GetArray())if(!ports.insert(p["port"].GetInt()).second||!names.insert(str(p["name"])).second)reject("DUPLICATE_INTERFACE_PORT","INVALID_EXTERNAL_PORT","Coupled interface ports and names must be unique",{"@"+id+"/",id},"",V(),"unique interface port and name");
        }
        local(doc["model"],{},false);
        if(doc["model"].HasMember("definitions"))for(const auto& d:doc["model"]["definitions"].GetArray())local(d,{"@"+str(d["id"])+"/",str(d["id"])},false);
        std::set<std::string> active,finished;dependencies(doc["model"],{},active,finished);
        if(doc["model"].HasMember("definitions"))for(const auto& d:doc["model"]["definitions"].GetArray())dependencies(d,{"@"+str(d["id"])+"/",str(d["id"])},active,finished);
        local(doc["model"],{});if(doc["model"].HasMember("definitions"))for(const auto& d:doc["model"]["definitions"].GetArray())local(d,{"@"+str(d["id"])+"/",str(d["id"])});
    }
    void check_bindings() {
        std::map<std::string,int> bindings;graph(doc["model"],{},{},bindings);
        if(doc["model"].HasMember("definitions"))for(const auto& d:doc["model"]["definitions"].GetArray())if(!done.contains(str(d["id"]))){std::map<std::string,int> b;graph(d,{"@"+str(d["id"])+"/",str(d["id"])},{},b);}
    }
};
