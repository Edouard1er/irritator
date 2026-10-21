#include <irritator/core.hpp>
#include <rapidjson/document.h>
#include <rapidjson/schema.h>
#include <rapidjson/stringbuffer.h>
#include <rapidjson/writer.h>
#include "contracts.hpp"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef IRRITATOR_ENABLE_DEBUG
#ifdef _WIN32
#include <io.h>
#else
#include <unistd.h>
#endif
#endif

namespace {
using V = rapidjson::Value;
using D = rapidjson::Document;
struct failure : std::runtime_error {
    std::string code;
    int category = -1, native = -1;
    failure(std::string c, std::string m) : std::runtime_error(m), code(std::move(c)) {}
};
[[noreturn]] void fail(const char* code, const std::string& message) { throw failure(code,message); }
void check(irt::status status, const char* code, const char* operation) {
    if (status.has_error()) {
        failure f(code,operation);
        f.category = static_cast<int>(status.error().cat());
        f.native = status.error().value();
        throw f;
    }
}
std::string str(const V& v) { return {v.GetString(),v.GetStringLength()}; }
void emit(const V& value) {
    rapidjson::StringBuffer buffer;
    rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
    if (!value.Accept(writer)) fail("SERIALIZATION_ERROR","Cannot serialize finite JSON result");
    std::cout << buffer.GetString() << '\n';
}
void unique_keys(const V& v, unsigned depth=0) {
    if (depth > 32) fail("INVALID_JSON","Maximum nesting depth exceeded");
    if (v.IsObject()) {
        std::set<std::string> names;
        for (auto it=v.MemberBegin();it!=v.MemberEnd();++it) {
            if (!names.insert(str(it->name)).second) fail("INVALID_JSON","Duplicate JSON member");
            unique_keys(it->value,depth+1);
        }
    } else if (v.IsArray()) for (const auto& item:v.GetArray()) unique_keys(item,depth+1);
}
template<class T> irt::model& allocate(irt::simulation& sim) { return irt::get_model(sim.alloc<T>()); }
using constructor = irt::model& (*)(irt::simulation&);
const std::map<std::string,constructor> registry{
    {"constant",allocate<irt::constant>}, {"qss1_sum_2",allocate<irt::qss1_sum_2>},
    {"qss1_sum_3",allocate<irt::qss1_sum_3>}, {"qss1_integrator",allocate<irt::qss1_integrator>},
    {"qss3_integrator",allocate<irt::qss3_integrator>}
};
const V& descriptor(const D& catalog,const std::string& type) {
    for(const auto& c:catalog["components"].GetArray()) if(str(c["type"])==type) return c;
    fail("UNKNOWN_COMPONENT","Unsupported component type: "+type);
}
int limit(const D& doc,const char* name,int cap) {
    return doc.HasMember("limits") && doc["limits"].HasMember(name) ? doc["limits"][name].GetInt() : cap;
}
void configure_debug_diagnostics() {
#ifdef IRRITATOR_ENABLE_DEBUG
    // The native Debug allocator opens irt-mem.txt, with stdout as fallback.
    // Keep that diagnostic stream out of the JSON protocol without changing
    // engine code. Refuse its stdout fallback before any engine allocation.
    auto* stream=irt::debug::mem_file();
    if(stream==stdout) fail("INITIALIZATION_ERROR","Cannot open Debug diagnostic stream in working directory");
#ifdef _WIN32
    const int redirected=_dup2(_fileno(stderr),_fileno(stream));
#else
    const int redirected=dup2(fileno(stderr),fileno(stream));
#endif
    if(redirected<0) fail("INITIALIZATION_ERROR","Cannot redirect Debug diagnostics to stderr");
#endif
}
D execute(const D& doc,const D& catalog) {
    const auto& model=doc["model"];
    const auto& components=model["components"];
    const double start=doc["simulation"]["start"].GetDouble(), end=doc["simulation"]["end"].GetDouble();
    if (!(end>start) || end-start>1e9) fail("INVALID_TIME","Expected start < end and horizon <= 1e9");
    const auto max_calls=limit(doc,"maxRunCalls",100000), max_points=limit(doc,"maxPoints",20000);
    if (components.Size()>unsigned(limit(doc,"maxComponents",128)) ||
        model["connections"].Size()>unsigned(limit(doc,"maxConnections",512))) fail("LIMIT_EXCEEDED","Model size budget exceeded");
    std::map<std::string,const V*> specs;
    for (const auto& c:components.GetArray()) {
        const auto id=str(c["id"]), type=str(c["type"]);
        if (!specs.emplace(id,&c).second) fail("INVALID_MODEL","Duplicate component id: "+id);
        const auto& desc=descriptor(catalog,type);
        if (!registry.contains(type)) fail("UNKNOWN_COMPONENT","Missing constructor: "+type);
        const auto& params=c["parameters"];
        for(const auto& key:desc["required"].GetArray()) if(!params.HasMember(key.GetString())) fail("INVALID_PARAMETER","Missing parameter: "+str(key));
        for(auto p=params.MemberBegin();p!=params.MemberEnd();++p) {
            if(!desc["parameters"].HasMember(p->name)) fail("INVALID_PARAMETER","Unknown parameter: "+str(p->name));
            const auto& bounds=desc["parameters"][p->name];
            double value=p->value.GetDouble();
            if(!std::isfinite(value) || value<bounds["minimum"].GetDouble() || value>bounds["maximum"].GetDouble()) fail("INVALID_PARAMETER","Parameter out of bounds: "+str(p->name));
        }
    }
    auto find=[&](const V& id)->const V& {
        auto it=specs.find(str(id));
        if(it==specs.end()) fail("INVALID_REFERENCE","Unknown component: "+str(id));
        return *it->second;
    };
    std::set<std::string> edges, observed;
    for(const auto& edge:model["connections"].GetArray()) {
        const auto& from=edge["from"]; const auto& to=edge["to"];
        const auto& a=descriptor(catalog,str(find(from["component"])["type"]));
        const auto& b=descriptor(catalog,str(find(to["component"])["type"]));
        if(from["port"].GetUint()>=a["outputs"].Size() || to["port"].GetUint()>=b["inputs"].Size()) fail("INVALID_CONNECTION","Invalid port number or direction");
        const auto key=str(from["component"])+":"+std::to_string(from["port"].GetInt())+">"+str(to["component"])+":"+std::to_string(to["port"].GetInt());
        if(!edges.insert(key).second) fail("INVALID_CONNECTION","Duplicate connection");
    }
    double estimated=0;
    for(const auto& o:model["observations"].GetArray()) {
        find(o["component"]);
        if(!observed.insert(str(o["component"])).second) fail("OBSERVATION_ERROR","Duplicate observation");
        const auto dt=o["samplingInterval"].GetDouble();
        if(!(start+dt>start) || !(end+dt>end)) fail("OBSERVATION_ERROR","Sampling interval cannot advance floating point time");
        estimated+=std::ceil((end-start)/dt)+2;
        if(estimated>max_points) fail("LIMIT_EXCEEDED","Potential sampling grid exceeds maxPoints (including terminal margin)");
    }

    configure_debug_diagnostics();
    irt::simulation sim;
    if(!sim.can_alloc(components.Size()) || !sim.can_connect(model["connections"].Size())) fail("LIMIT_EXCEEDED","Engine capacity unavailable");
    std::map<std::string,irt::model_id> ids;
    for(const auto& c:components.GetArray()) {
        const auto type=str(c["type"]);
        auto& native=registry.at(type)(sim);
        const auto id=sim.get_id(native);
        ids.emplace(str(c["id"]),id);
        const auto& p=c["parameters"];
        if(type=="constant") sim.parameters[id].set_constant(p["value"].GetDouble(),p["offset"].GetDouble());
        else if(type=="qss1_integrator" || type=="qss3_integrator") sim.parameters[id].set_integrator(p["X"].GetDouble(),p["dQ"].GetDouble());
    }
    for(const auto& e:model["connections"].GetArray())
        check(sim.connect(sim.models.get(ids.at(str(e["from"]["component"]))),e["from"]["port"].GetInt(),
                          sim.models.get(ids.at(str(e["to"]["component"]))),e["to"]["port"].GetInt()),"INVALID_CONNECTION","simulation.connect");
    sim.limits.set_bound(start,end);
    std::vector<irt::observer_id> observers;
    for(const auto& o:model["observations"].GetArray()) {
        auto& m=sim.models.get(ids.at(str(o["component"])));
        check(sim.observe(m,o["samplingInterval"].GetDouble()),"OBSERVATION_ERROR","simulation.observe");
        observers.push_back(m.obs_id);
    }
    check(sim.initialize(),"INITIALIZATION_ERROR","simulation.initialize");
    unsigned calls=0;
    try {
        while(!sim.current_time_expired()) {
            if(calls>=unsigned(max_calls)) fail("LIMIT_EXCEEDED","Scheduler call budget exceeded");
            ++calls;
            check(sim.run(),"EXECUTION_ERROR","simulation.run");
            sim.tick_resamplers();
        }
    } catch(...) {
        const auto cleanup=sim.finalize();
        if(cleanup.has_error()) std::cerr << "finalize failed during error cleanup\n";
        throw;
    }
    check(sim.finalize(),"EXECUTION_ERROR","simulation.finalize");
    sim.tick_resamplers();
    for(auto id:observers) sim.observers.get<irt::resampler>(id).tick(*sim.observers.try_to_get(id),std::numeric_limits<double>::infinity());

    D result(rapidjson::kObjectType); auto& a=result.GetAllocator();
    result.AddMember("schemaVersion",1,a).AddMember("status","completed",a);
    result.AddMember("modelId",V(model["id"],a),a);
    V timing(rapidjson::kObjectType);
    const double final_time=sim.current_time();
    if(!std::isfinite(final_time) || final_time!=end) fail("EXECUTION_ERROR","Unexpected final time");
    timing.AddMember("start",start,a).AddMember("end",end,a).AddMember("finalTime",final_time,a).AddMember("runCalls",calls,a);
    result.AddMember("simulation",timing,a);
    V observations(rapidjson::kArrayType);
    std::size_t total=0, index=0;
    for(const auto& o:model["observations"].GetArray()) {
        V output(rapidjson::kObjectType), samples(rapidjson::kArrayType);
        output.AddMember("component",V(o["component"],a),a).AddMember("samplingInterval",o["samplingInterval"].GetDouble(),a);
        sim.observers.try_to_get(observers.at(index++))->read_history([&](const auto& history,const auto) {
            double previous=-std::numeric_limits<double>::infinity();
            for(const auto& s:history) {
                if(++total>unsigned(max_points)) fail("LIMIT_EXCEEDED","Output point budget exceeded");
                if(!std::isfinite(s.t) || !std::isfinite(s.value) || s.t<start || s.t>end || s.t<=previous) fail("OBSERVATION_ERROR","Non-finite or unordered history");
                previous=s.t;
                V point(rapidjson::kObjectType);
                point.AddMember("time",s.t,a).AddMember("value",s.value,a);
                samples.PushBack(point,a);
            }
        });
        if(samples.Empty()) fail("OBSERVATION_ERROR","No published samples for requested component");
        output.AddMember("samples",samples,a); observations.PushBack(output,a);
    }
    result.AddMember("observations",observations,a);
    V diagnostics(rapidjson::kObjectType);
    diagnostics.AddMember("observationPolicy","engine-resampled-sealed-deduplicated",a).AddMember("engineVersion","0.1.0",a).AddMember("adapterVersion","0.1.0",a);
    result.AddMember("diagnostics",diagnostics,a);
    return result;
}
}
int main(int argc,char** argv) {
    try {
        D catalog; catalog.Parse(catalog_json);
        if(argc==2 && std::string(argv[1])=="--describe") { emit(catalog); return 0; }
        if(argc!=1) fail("INVALID_ARGUMENT","Only --describe is supported");
        std::string input; char buffer[4096];
        while(std::cin.read(buffer,sizeof buffer) || std::cin.gcount()) {
            input.append(buffer,static_cast<std::size_t>(std::cin.gcount()));
            if(input.size()>1048576) fail("LIMIT_EXCEEDED","stdin exceeds 1 MiB");
        }
        if(input.find('\0')!=std::string::npos) fail("INVALID_JSON","NUL byte in JSON document");
        D doc; doc.Parse<rapidjson::kParseValidateEncodingFlag | rapidjson::kParseIterativeFlag>(input.data(),input.size());
        if(doc.HasParseError()) fail("INVALID_JSON","Invalid JSON document at byte "+std::to_string(doc.GetErrorOffset()));
        unique_keys(doc);
        D schema; schema.Parse(request_schema_json);
        rapidjson::SchemaDocument compiled(schema);
        rapidjson::SchemaValidator validator(compiled);
        if(!doc.Accept(validator)) {
            rapidjson::StringBuffer path; validator.GetInvalidDocumentPointer().StringifyUriFragment(path);
            fail("INVALID_MODEL",std::string("Schema violation at ")+path.GetString()+" ("+validator.GetInvalidSchemaKeyword()+")");
        }
        emit(execute(doc,catalog));
        return 0;
    } catch(const failure& f) {
        D result(rapidjson::kObjectType); auto& a=result.GetAllocator();
        V error(rapidjson::kObjectType);
        error.AddMember("code",V(f.code.c_str(),a),a).AddMember("message",V(f.what(),a),a);
        if(f.category>=0) { error.AddMember("engineCategory",f.category,a); error.AddMember("engineCode",f.native,a); }
        result.AddMember("schemaVersion",1,a).AddMember("status","failed",a).AddMember("error",error,a);
        emit(result); std::cerr << f.code << ": " << f.what() << '\n'; return 2;
    } catch(const std::exception& e) {
        std::cerr << "INTERNAL_ERROR: " << e.what() << '\n';
        std::cout << "{\"schemaVersion\":1,\"status\":\"failed\",\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"Runner internal failure\"}}\n";
        return 3;
    }
}
